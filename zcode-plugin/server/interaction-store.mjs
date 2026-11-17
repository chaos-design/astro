/**
 * In-memory interaction records plus the one file the synchronous hook can
 * read: `<ASTRO_HOME>/interactions/<requestId>.json`, written when a request
 * closes. Requests live for the hook's configured window (the installer's
 * `--timeout`, seconds), so they are not persisted as a store of record —
 * only the request and result snapshots are written, each through a temp file
 * and a rename so a polling hook never reads half a document.
 *
 * One `setTimeout` per request is the only timer. Closing a request clears it;
 * the timeout path calls the same `finish()` as an explicit close, which is
 * what makes `interaction.close` exactly-once. A request opened with no
 * console attached to the stream closes at once: nobody can ever answer it.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  INTERACTION_RESULT_STATUSES,
  buildAgentNotification,
  buildInteractionResult,
  validateAnswers,
  validateInteractionEvent,
  validateInteractionRequest,
} from "../plugin/interaction-contract.mjs";

export class InteractionStoreError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "InteractionStoreError";
    this.status = status;
  }
}

function writeJsonAtomic(target, value) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, target);
}

function requestIdOf(value) {
  return String(value || "").trim();
}

const notificationKinds = {
  answered: "answer_applied",
  cancelled: "answer_cancelled",
  timeout: "interaction_timeout",
  expired: "fallback_prompt",
};

/**
 * The one notification a closed interaction produces. It names counts and the
 * device, never an answer value: the answer travels in the host's
 * `tool_input.answers`, not in a message the console or the log can quote.
 */
export function buildInteractionNotification(request, result, options = {}) {
  const answered = Object.keys(result.answers || {}).length;
  const skipped = request.questions.filter(
    (question) =>
      question.required === false && !result.answers?.[question.question],
  ).length;
  const device = result.answeredBy || "console";
  const count = `${answered} question${answered === 1 ? "" : "s"}`;
  const summary =
    result.status === "answered"
      ? `User answered ${count} via ${device}; the answers were injected by the host hook.`
      : result.status === "cancelled" && device === "service"
        ? "No console page was attached, so the question was closed at once; the host's native prompt is in charge."
        : result.status === "cancelled"
          ? `The user cancelled the question via ${device}; the host's native prompt is in charge.`
          : result.status === "timeout"
            ? "The question expired without an answer; the host's native prompt is in charge."
            : "The session ended before an answer; the host's native prompt is in charge.";
  return buildAgentNotification(
    {
      requestId: request.requestId,
      kind: notificationKinds[result.status] || "fallback_prompt",
      target: "user",
      channel: "trace",
      sessionId: request.sessionId,
      toolUseId: request.toolUseId,
      summary,
      detail: {
        answered,
        skipped,
        answeredBy: device,
        elapsedMs: result.elapsedMs || 0,
      },
      ttlMs: 0,
    },
    options,
  );
}

export function createInteractionStore(options = {}) {
  const now = options.now || (() => Date.now());
  const directory = join(options.astroHome || "", "interactions");
  const onOpen = options.onOpen || (() => {});
  const onUpdate = options.onUpdate || (() => {});
  const onClose = options.onClose || (() => {});
  const hasStreamClients = options.hasStreamClients || (() => true);
  const records = new Map();

  function pathFor(requestId, suffix) {
    return join(directory, `${requestId}${suffix}`);
  }

  function finish(record, status, answers, answeredBy) {
    if (record.result) {
      return record.result;
    }
    if (record.timer) {
      clearTimeout(record.timer);
      record.timer = null;
    }
    record.result = buildInteractionResult(record.request, status, answers, {
      now: now(),
      answeredBy,
    });
    writeJsonAtomic(pathFor(record.request.requestId, ".json"), record.result);
    onClose(record.result, record.request);
    return record.result;
  }

  function scheduleTimeout(record) {
    const ttl = Number(record.request.ttlMs) || 0;
    record.timer = setTimeout(() => {
      record.timer = null;
      finish(record, "timeout", {}, "timeout");
    }, ttl);
    record.timer.unref?.();
  }

  function requireRecord(requestId) {
    const record = records.get(requestIdOf(requestId));
    if (!record) {
      throw new InteractionStoreError(404, "Interaction not found");
    }
    return record;
  }

  return {
    directory,

    init() {
      mkdirSync(directory, { recursive: true });
    },

    /** Idempotent: a host retry of the same call keeps the first record. */
    create(request) {
      const validation = validateInteractionRequest(request);
      if (!validation.valid) {
        throw new InteractionStoreError(400, validation.errors.join("; "));
      }
      const existing = records.get(request.requestId);
      if (existing) {
        return { request: existing.request, created: false };
      }
      const record = {
        request: { ...request },
        events: [],
        seq: 0,
        result: null,
        timer: null,
      };
      records.set(request.requestId, record);
      writeJsonAtomic(pathFor(request.requestId, ".request.json"), request);
      scheduleTimeout(record);
      onOpen(record.request);
      // Interaction frames are never replayed on reconnect, so a request
      // opened with no console attached to the stream can never be answered.
      // Close it at once — `cancelled` is in the hook's break set, so the
      // host's native prompt returns immediately instead of the synchronous
      // window blocking for nobody.
      if (!hasStreamClients()) {
        finish(record, "cancelled", {}, "service");
      }
      return { request: record.request, created: true };
    },

    /**
     * Append one InteractionEvent. Duplicate `eventId` is a replay and returns
     * the stored outcome; a decreasing `seq` or an event after the close is a
     * conflict, because either one would let a stale client rewrite an answer.
     */
    append(requestId, event) {
      const record = requireRecord(requestId);
      const id = record.request.requestId;
      if (event?.requestId && event.requestId !== id) {
        throw new InteractionStoreError(409, "requestId does not match the route");
      }
      // A replay is recognized by its idempotency key before seq validation:
      // the same event sent twice carries the same — now old — seq.
      const duplicate = record.events.find((item) => item.eventId === event?.eventId);
      if (duplicate) {
        return {
          event: duplicate,
          result: record.result,
          duplicate: true,
        };
      }
      const validation = validateInteractionEvent(event, {
        previousSeq: record.seq,
        revision: record.request.revision,
      });
      if (!validation.valid) {
        throw new InteractionStoreError(400, validation.errors.join("; "));
      }
      if (record.result) {
        throw new InteractionStoreError(409, "Interaction already closed");
      }

      if (event.action === "replace") {
        record.request = {
          ...record.request,
          questions: event.questions,
          revision: event.revision,
        };
        writeJsonAtomic(pathFor(id, ".request.json"), record.request);
      }

      let answers = null;
      if (event.action === "submit") {
        const validationAnswers = validateAnswers(
          event.answers || {},
          record.request.questions,
          { allowText: true },
        );
        if (!validationAnswers.valid) {
          throw new InteractionStoreError(400, validationAnswers.errors.join("; "));
        }
        answers = validationAnswers.answers;
      }

      record.events.push(event);
      record.seq = event.seq;
      onUpdate(event);

      if (event.action === "submit") {
        return {
          event,
          result: finish(record, "answered", answers, event.deviceId || "console"),
          duplicate: false,
        };
      }
      if (event.action === "cancel") {
        return {
          event,
          result: finish(record, "cancelled", {}, event.deviceId || "console"),
          duplicate: false,
        };
      }
      if (event.action === "timeout" || event.action === "expire") {
        return {
          event,
          result: finish(
            record,
            event.action === "timeout" ? "timeout" : "expired",
            {},
            event.deviceId || "console",
          ),
          duplicate: false,
        };
      }
      return { event, result: null, duplicate: false };
    },

    /** Close from the console; repeating a close returns the first result. */
    close(requestId, body = {}) {
      const record = requireRecord(requestId);
      if (record.result) {
        return { result: record.result, duplicate: true };
      }
      const status = body.status || "cancelled";
      if (!INTERACTION_RESULT_STATUSES.includes(status)) {
        throw new InteractionStoreError(400, "unknown interaction status");
      }
      let answers = {};
      if (status === "answered") {
        const validation = validateAnswers(body.answers || {}, record.request.questions, {
          allowText: true,
        });
        if (!validation.valid) {
          throw new InteractionStoreError(400, validation.errors.join("; "));
        }
        answers = validation.answers;
      }
      return {
        result: finish(record, status, answers, body.answeredBy || "console"),
        duplicate: false,
      };
    },

    get(requestId) {
      const record = records.get(requestIdOf(requestId));
      if (!record) {
        return null;
      }
      return {
        request: record.request,
        events: record.events.map((event) => ({ ...event })),
        result: record.result,
      };
    },

    size() {
      return records.size;
    },

    stop() {
      for (const record of records.values()) {
        if (record.timer) {
          clearTimeout(record.timer);
          record.timer = null;
        }
      }
    },
  };
}
