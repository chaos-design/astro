import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
const server = readFileSync(
  new URL("../server/server.mjs", import.meta.url),
  "utf8",
);
const repository = readFileSync(
  new URL("../server/trace-repository.mjs", import.meta.url),
  "utf8",
);

/**
 * A restart has to re-read the history, not replay a tail: the new process
 * parses the trace files from scratch, so anything written, removed or
 * rewritten while the service was down only shows up in a full snapshot.
 * The filter is what the reload has to honour — agent, default range, Live.
 */
test("a restart drops the cursor and asks for a full snapshot", () => {
  const restart = app.slice(
    app.indexOf("const restartDashboard = async ()"),
    app.indexOf("// Locating an atom only needs"),
  );
  assert.match(restart, /resumeCursorRef\.current = ""/);
  assert.match(restart, /forceSnapshotRef\.current = true/);
  assert.match(restart, /setReloadingEvents\(true\)/);
  // The window snaps back to the configured range, so the list describes the
  // filter rather than a hand-widened window the new process may not contain.
  assert.match(restart, /setRunHistoryHours\(historyRangeHours\)/);
  assert.match(restart, /setStreamEpoch\(\(current\) => current \+ 1\)/);
});

test("the forced snapshot names the history already on screen", () => {
  assert.match(
    app,
    /const knownSnapshot = forceSnapshot \? snapshotKeyRef\.current : ""/,
  );
  assert.match(app, /streamParams\.set\("snapshot", knownSnapshot\)/);
  assert.match(app, /streamParams\.set\("since", resumeCursor\)/);
});

test("an unchanged snapshot is acknowledged, not re-applied", () => {
  // Client: `reset-same` finishes the reload without touching the events.
  const sameHandler = app.slice(
    app.indexOf('source.addEventListener("reset-same"'),
    app.indexOf('source.addEventListener("reset"'),
  );
  assert.ok(sameHandler.length > 0, "reset-same listener missing");
  assert.doesNotMatch(sameHandler, /setLiveEvents/);
  assert.match(sameHandler, /setReloadingEvents\(false\)/);
  assert.match(sameHandler, /snapshotKeyRef\.current = payload\.snapshot/);

  // Client fallback when no key is available: replace the array only on a real
  // difference, because replacing it forces a full session rebuild.
  assert.match(app, /const unchanged =\s*\n?\s*current\.length === payload\.events\.length/);
  assert.match(app, /isSameEventSequence\(payload\.events, current\)/);
  assert.match(app, /if \(!unchanged\) \{\s*\n\s*setLiveEvents\(events\);/);
});

test("the server can answer with reset-same and advertises the key", () => {
  assert.match(server, /sendSse\(response, "reset-same", \{/);
  assert.match(server, /const snapshotKey = store\.getSnapshotKey\(\)/);
  assert.match(server, /clientSnapshot === snapshotKey/);
  assert.match(server, /snapshot: snapshotKey,\n\s+connectedAt:/);
  assert.match(repository, /getSnapshotKey\(\) \{/);
});

test("the header says restarting or reloading, never offline, in between", () => {
  assert.match(app, /const reconnecting = restarting \|\| reloadingEvents;/);
  assert.match(app, /\{restarting \? "restarting" : "reloading"\}/);
});
