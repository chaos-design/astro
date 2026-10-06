import { EventEmitter } from "node:events";
import {
  createReadStream,
  createWriteStream,
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readSync,
  statSync,
  truncateSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

export function parseTraceLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const value = JSON.parse(trimmed);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Trace line must contain a JSON object.");
  }

  return value;
}

export async function readTraceFile(traceFile) {
  if (!existsSync(traceFile)) {
    return [];
  }

  const events = [];
  const input = createReadStream(traceFile, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    try {
      const event = parseTraceLine(line);
      if (event) {
        events.push(event);
      }
    } catch {
      // A malformed line is isolated instead of hiding the rest of the trace.
    }
  }

  return events;
}

export class TraceStore extends EventEmitter {
  constructor(traceFile, pollInterval = 250) {
    super();
    this.traceFile = traceFile;
    this.pollInterval = pollInterval;
    this.events = [];
    this.eventIds = new Set();
    this.offset = 0;
    this.pendingBytes = Buffer.alloc(0);
    this.endsWithNewline = true;
    this.generation = 0;
    this.timer = null;
    this.reading = false;
  }

  async initialize() {
    mkdirSync(dirname(this.traceFile), { recursive: true });
    if (!existsSync(this.traceFile)) {
      closeSync(openSync(this.traceFile, "a"));
    }
    const bytes = await readFile(this.traceFile);
    this.offset = bytes.length;
    this.consume(bytes);
    // Accept a complete final record, but retain an unfinished write.
    if (this.pendingBytes.length) {
      try {
        this.record(parseTraceLine(this.pendingBytes.toString("utf8")));
        this.pendingBytes = Buffer.alloc(0);
      } catch {
        // The next poll can complete this JSON fragment.
      }
    }
    return this.events;
  }

  start() {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => this.poll(), this.pollInterval);
    this.timer.unref();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getEvents() {
    return [...this.events];
  }

  getEvent(eventId) {
    return this.events.find((event) => event.id === eventId) || null;
  }

  append(inputEvents) {
    this.generation += 1;
    this.readPendingSync();
    const knownIds = new Set(this.eventIds);
    const events = inputEvents.filter((event) => {
      if (event.id && knownIds.has(event.id)) return false;
      if (event.id) knownIds.add(event.id);
      return true;
    });
    if (!events.length) {
      return [];
    }

    const content = `${this.endsWithNewline ? "" : "\n"}${events
      .map((event) => JSON.stringify(event))
      .join("\n")}\n`;
    appendFileSync(this.traceFile, content, "utf8");
    this.readPendingSync();
    return events;
  }

  clear() {
    truncateSync(this.traceFile, 0);
    this.reset();
    this.emit("reset");
  }

  reset() {
    this.generation += 1;
    this.events = [];
    this.eventIds.clear();
    this.offset = 0;
    this.pendingBytes = Buffer.alloc(0);
    this.endsWithNewline = true;
  }

  record(event) {
    if (!event || (event.id && this.eventIds.has(event.id))) return;
    if (event.id) this.eventIds.add(event.id);
    this.events.push(event);
    this.emit("event", event);
  }

  consume(bytes) {
    if (!bytes.length) return;
    this.endsWithNewline = bytes.at(-1) === 10;
    const content = Buffer.concat([this.pendingBytes, bytes]);
    const generation = this.generation;
    let start = 0;
    let boundary;
    while ((boundary = content.indexOf(10, start)) >= 0) {
      const line = content.subarray(start, boundary).toString("utf8");
      let event;
      try {
        event = parseTraceLine(line);
      } catch {
        this.emit("invalid-line", line);
      }
      this.record(event);
      if (generation !== this.generation) return;
      start = boundary + 1;
    }
    this.pendingBytes = Buffer.from(content.subarray(start));
  }

  readPendingSync() {
    const size = statSync(this.traceFile).size;
    const truncated = size < this.offset;
    if (truncated) this.reset();
    if (size > this.offset) {
      const file = openSync(this.traceFile, "r");
      try {
        const buffer = Buffer.alloc(Math.min(size - this.offset, 64 * 1024));
        while (this.offset < size) {
          const count = readSync(file, buffer, 0, Math.min(buffer.length, size - this.offset), this.offset);
          if (!count) break;
          this.offset += count;
          this.consume(buffer.subarray(0, count));
        }
      } finally {
        closeSync(file);
      }
    }
    if (truncated) this.emit("reset", this.getEvents());
  }

  async poll() {
    if (this.reading || !existsSync(this.traceFile)) {
      return;
    }

    this.reading = true;
    try {
      const size = statSync(this.traceFile).size;
      const truncated = size < this.offset;
      if (truncated) this.reset();
      const generation = this.generation;
      if (size > this.offset) {
        const stream = createReadStream(this.traceFile, {
          start: this.offset, end: size - 1,
        });
        for await (const bytes of stream) {
          if (generation !== this.generation) break;
          this.offset += bytes.length;
          this.consume(bytes);
        }
      }
      if (truncated && generation === this.generation) {
        this.emit("reset", this.getEvents());
      }
    } catch (error) {
      this.emit("error", error);
    } finally {
      this.reading = false;
    }
  }

  exportTo(stream = createWriteStream(this.traceFile, { flags: "a" })) {
    for (const event of this.events) {
      stream.write(`${JSON.stringify(event)}\n`);
    }
    stream.end();
  }
}
