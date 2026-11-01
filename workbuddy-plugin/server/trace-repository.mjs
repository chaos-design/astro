import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import storagePaths from "../plugin/storage-paths.cjs";
import {
  applySessionEvent,
  createSessionRecord,
  serializeSessionRecord,
} from "./session-state.mjs";
import { TraceStore } from "./trace-store.mjs";

const {
  resolveAgentTraceFile,
  resolveAstroHome,
  resolveTraceDirectory,
} = storagePaths;

function walkTraceFiles(root, output = []) {
  if (!existsSync(root)) {
    return output;
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "plugins") {
      continue;
    }
    const entryPath = join(root, entry.name);
    if (entry.isDirectory()) {
      walkTraceFiles(entryPath, output);
    } else if (
      entry.isFile() &&
      entry.name === "events.jsonl" &&
      statSync(entryPath).isFile()
    ) {
      output.push(entryPath);
    }
  }
  return output;
}

function compareEvents(left, right) {
  const timestampDelta =
    Date.parse(left.capturedAt || 0) - Date.parse(right.capturedAt || 0);
  if (timestampDelta) {
    return timestampDelta;
  }
  return String(left.id).localeCompare(String(right.id));
}

export class TraceRepository extends EventEmitter {
  constructor(
    environment = process.env,
    { discoveryInterval = 500, pollInterval = 250 } = {},
  ) {
    super();
    this.environment = environment;
    this.discoveryInterval = discoveryInterval;
    this.pollInterval = pollInterval;
    this.stores = new Map();
    this.initializing = new Map();
    this.discoveryTimer = null;
    this.running = false;
    // Derived views. `getEvents()` merges and sorts every store, which costs
    // O(n log n) per call — health checks and every SSE connect used to pay
    // for that on each request. The merged list is now cached until an event
    // or a reset invalidates it.
    this.mergedEvents = null;
    this.knownEventIds = new Set();
    this.unidentifiedEventCount = 0;
    this.sessionRecords = new Map();
  }

  invalidateDerived() {
    this.mergedEvents = null;
  }

  /** Fold one event into the per-session state summary. */
  indexEvent(event) {
    if (!event || typeof event !== "object") {
      return;
    }
    const id = event.id ? String(event.id) : "";
    if (id) {
      if (this.knownEventIds.has(id)) {
        return;
      }
      this.knownEventIds.add(id);
    } else {
      this.unidentifiedEventCount += 1;
    }
    const key = `${event.source || "generic"}::${
      event.sessionId || "unknown-session"
    }`;
    let record = this.sessionRecords.get(key);
    if (!record) {
      record = createSessionRecord(key, event);
      this.sessionRecords.set(key, record);
    }
    applySessionEvent(record, event);
  }

  /** Rebuild every derived view from the current store contents. */
  rebuildDerived() {
    this.knownEventIds.clear();
    this.unidentifiedEventCount = 0;
    this.sessionRecords.clear();
    this.mergedEvents = null;
    for (const event of this.getEvents()) {
      this.indexEvent(event);
    }
  }

  discoverTraceFiles() {
    const astroHome = resolveAstroHome(this.environment);
    const configuredRoot =
      this.environment.ASTRO_TRACE_DIR ||
      this.environment.AGENT_TRACE_DIR ||
      this.environment.TRAE_TRACE_DIR;
    return walkTraceFiles(
      configuredRoot
        ? resolveTraceDirectory("generic", {}, this.environment)
        : astroHome,
    ).sort();
  }

  async ensureStore(traceFile) {
    if (this.stores.has(traceFile)) {
      return this.stores.get(traceFile);
    }
    if (this.initializing.has(traceFile)) {
      return this.initializing.get(traceFile);
    }

    const initialization = (async () => {
      const store = new TraceStore(traceFile, this.pollInterval);
      await store.initialize();
      // Store contents read at startup were recorded before this listener
      // existed, so fold them into the derived views here.
      for (const event of store.getEvents()) {
        this.indexEvent(event);
      }
      // The folded events are new to the merged snapshot cache too. Without
      // this the discovery reset below broadcast the previous snapshot while
      // the derived counts already included the file — a freshly written
      // session stayed invisible until one of its events arrived.
      this.invalidateDerived();
      store.on("event", (event) => {
        this.indexEvent(event);
        this.invalidateDerived();
        this.emit("event", event);
      });
      store.on("reset", () => {
        this.rebuildDerived();
        this.emit("reset", this.getEvents());
      });
      store.on("error", (error) => this.emit("error", error));
      this.stores.set(traceFile, store);
      if (this.running) {
        store.start();
      }
      this.initializing.delete(traceFile);
      return store;
    })();
    this.initializing.set(traceFile, initialization);
    return initialization;
  }

  async discover() {
    const previousCount = this.stores.size;
    const traceFiles = this.discoverTraceFiles();
    await Promise.all(traceFiles.map((traceFile) => this.ensureStore(traceFile)));
    if (this.running && this.stores.size > previousCount) {
      this.emit("reset", this.getEvents());
    }
  }

  async initialize() {
    mkdirSync(resolveAstroHome(this.environment), { recursive: true });
    await this.discover();
    return this.getEvents();
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    for (const store of this.stores.values()) {
      store.start();
    }
    this.discoveryTimer = setInterval(() => {
      this.discover().catch((error) => this.emit("error", error));
    }, this.discoveryInterval);
    this.discoveryTimer.unref();
  }

  stop() {
    this.running = false;
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
    for (const store of this.stores.values()) {
      store.stop();
    }
  }

  getEvents() {
    if (this.mergedEvents) {
      return this.mergedEvents;
    }
    const knownIds = new Set();
    this.mergedEvents = [...this.stores.values()]
      .flatMap((store) => store.getEvents())
      .filter((event) => {
        if (!event.id) return true;
        if (knownIds.has(event.id)) return false;
        knownIds.add(event.id);
        return true;
      })
      .sort(compareEvents);
    return this.mergedEvents;
  }

  /** O(1): the derived views keep a running count. */
  getEventCount() {
    return this.knownEventIds.size + this.unidentifiedEventCount;
  }

  /**
   * Per-session capture state (`active` / `waiting` / `complete` / `failed` /
   * `terminated` plus an explicit terminal reason), newest first.
   */
  getSessionSummaries() {
    return [...this.sessionRecords.values()]
      .map(serializeSessionRecord)
      .sort(
        (left, right) =>
          Date.parse(right.lastEventAt || 0) - Date.parse(left.lastEventAt || 0),
      );
  }

  /** `{ active, waiting, complete, failed, terminated }` counts. */
  getSessionStateCounts() {
    const counts = {
      active: 0,
      waiting: 0,
      complete: 0,
      failed: 0,
      terminated: 0,
    };
    for (const record of this.sessionRecords.values()) {
      counts[record.state] = (counts[record.state] || 0) + 1;
    }
    return counts;
  }

  getEvent(eventId) {
    for (const store of this.stores.values()) {
      const event = store.getEvent(eventId);
      if (event) {
        return event;
      }
    }
    return null;
  }

  getTraceFiles() {
    return [...this.stores.keys()].sort();
  }

  async append(inputEvents) {
    // Known ids live in one set maintained by the derived views: scanning
    // every store's event list per POST was O(n) for no benefit.
    const knownIds = this.knownEventIds;
    const eventsByFile = new Map();
    const traceFileBySession = new Map();

    for (const event of inputEvents) {
      const id = event.id ? String(event.id) : "";
      if (id && knownIds.has(id)) {
        continue;
      }
      if (id) {
        knownIds.add(id);
      }
      const sessionKey = `${event.source || "generic"}::${
        event.sessionId || "unknown-session"
      }`;
      let traceFile = traceFileBySession.get(sessionKey);
      if (!traceFile) {
        traceFile = resolveAgentTraceFile(
          event.source || "generic",
          event,
          this.environment,
        );
        traceFileBySession.set(sessionKey, traceFile);
      }
      const group = eventsByFile.get(traceFile) || [];
      group.push(event);
      eventsByFile.set(traceFile, group);
    }

    const appended = [];
    for (const [traceFile, events] of eventsByFile) {
      const store = await this.ensureStore(traceFile);
      appended.push(...store.append(events));
    }
    return appended;
  }

  clear() {
    for (const store of this.stores.values()) {
      store.clear();
    }
  }
}
