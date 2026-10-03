import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import storagePaths from "../plugin/storage-paths.cjs";
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
      store.on("event", (event) => this.emit("event", event));
      store.on("reset", () => this.emit("reset", this.getEvents()));
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
    const knownIds = new Set();
    return [...this.stores.values()]
      .flatMap((store) => store.getEvents())
      .filter((event) => {
        if (!event.id) return true;
        if (knownIds.has(event.id)) return false;
        knownIds.add(event.id);
        return true;
      })
      .sort(compareEvents);
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
    const knownIds = new Set(this.getEvents().map((event) => event.id));
    const eventsByFile = new Map();
    const traceFileBySession = new Map();

    for (const event of inputEvents) {
      if (knownIds.has(event.id)) {
        continue;
      }
      knownIds.add(event.id);
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
