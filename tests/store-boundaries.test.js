import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TraceStore } from "../server/trace-store.mjs";

async function fixture(t, initial = "") {
  const root = mkdtempSync(join(tmpdir(), "astro-store-boundary-"));
  const file = join(root, "events.jsonl");
  writeFileSync(file, initial);
  const store = new TraceStore(file);
  t.after(() => {
    store.stop();
    rmSync(root, { recursive: true, force: true });
  });
  await store.initialize();
  return { store, file };
}

async function poll(t, store) {
  await store.poll();
  await t.waitFor(() => assert.equal(store.reading, false));
}

test("local appends do not skip external records waiting to be polled", async (t) => {
  const { store, file } = await fixture(t);
  appendFileSync(file, '{"id":"external"}\n');
  store.append([{ id: "api" }]);
  await poll(t, store);
  assert.deepEqual(store.getEvents().map((event) => event.id), ["external", "api"]);
});

test("deduplicates IDs within one append batch and when tailing", async (t) => {
  const { store, file } = await fixture(t);
  assert.equal(store.append([{ id: "same" }, { id: "same" }]).length, 1);
  appendFileSync(file, '{"id":"same"}\n{"id":"next"}\n');
  await poll(t, store);
  assert.deepEqual(store.getEvents().map((event) => event.id), ["same", "next"]);
});

test("retains an incomplete line across initialization and later append", async (t) => {
  const { store, file } = await fixture(t, '{"id":"par');
  appendFileSync(file, 'tial"}\n');
  await poll(t, store);
  assert.deepEqual(store.getEvents(), [{ id: "partial" }]);
});

test("retains UTF-8 code points split across polls", async (t) => {
  const { store, file } = await fixture(t);
  const bytes = Buffer.from('{"id":"utf8","message":"\u4e2d"}\n');
  const boundary = bytes.indexOf(Buffer.from("\u4e2d")) + 1;
  appendFileSync(file, bytes.subarray(0, boundary));
  await poll(t, store);
  appendFileSync(file, bytes.subarray(boundary));
  await poll(t, store);
  assert.equal(store.getEvent("utf8")?.message, "\u4e2d");
});

test("clear invalidates a started poll and preserves later events", async (t) => {
  const { store, file } = await fixture(t);
  appendFileSync(file, '{"id":"old"}\n');
  const polling = store.poll();
  store.clear();
  store.append([{ id: "new" }]);
  await polling;
  await t.waitFor(() => assert.equal(store.reading, false));
  await poll(t, store);
  assert.deepEqual(store.getEvents(), [{ id: "new" }]);
  assert.equal(readFileSync(file, "utf8"), '{"id":"new"}\n');
});

test("isolates malformed rows and reloads a truncated file", async (t) => {
  const { store, file } = await fixture(t, 'invalid\n{"id":"initial-long-id"}\n');
  assert.deepEqual(store.getEvents(), [{ id: "initial-long-id" }]);
  writeFileSync(file, '{"id":"new"}\n');
  await poll(t, store);
  assert.deepEqual(store.getEvents(), [{ id: "new" }]);
});
