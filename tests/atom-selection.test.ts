import assert from "node:assert/strict";
import test from "node:test";
import {
  isFollowingLive,
  isLiveFollowingLatest,
  isPromptExecuting,
  resolveLocateAtomId,
  resolveSelectedAtomId,
  toggleAtomSelection,
} from "../src/lib/atom-selection.ts";

test("uses the mapped atom for active and terminal events", () => {
  assert.equal(
    resolveSelectedAtomId(undefined, "harness-tool-call"),
    "harness-tool-call",
  );
  assert.equal(
    resolveSelectedAtomId(undefined, "harness-output-commit"),
    "harness-output-commit",
  );
});

test("preserves a manual selection after a completed flow", () => {
  assert.equal(
    resolveSelectedAtomId("harness-model-invoke", "harness-output-commit"),
    "harness-model-invoke",
  );
});

test("clicking the selected atom explicitly clears selection", () => {
  const selected = toggleAtomSelection(undefined, "harness-run");
  const cleared = toggleAtomSelection(selected, "harness-run");

  assert.equal(selected, "harness-run");
  assert.equal(cleared, null);
  assert.equal(resolveSelectedAtomId(cleared, "harness-run"), "");
});

test("manual atom selection and deselection both leave Live mode", () => {
  assert.equal(isFollowingLive(undefined, false, true), true);
  const selected = toggleAtomSelection(undefined, "harness-tool-call");
  assert.equal(isFollowingLive(selected, false, true), false);
  assert.equal(isFollowingLive(toggleAtomSelection(selected, "harness-tool-call"), false, true), false);
});

test("seeking or inspecting history never highlights Live", () => {
  assert.equal(isFollowingLive(undefined, true, true), false);
  assert.equal(isFollowingLive(undefined, false, false), false);
  assert.equal(isFollowingLive("harness-run", true, true), false);
});

test("clearing the manual override restores Live at the latest session", () => {
  assert.equal(isFollowingLive("harness-run", false, true), false);
  assert.equal(isFollowingLive(undefined, false, true), true);
});

test("derives Prompt execution only from its own status and demo mode", () => {
  assert.equal(isPromptExecuting("active", false), true);
  assert.equal(isPromptExecuting("complete", false), false);
  assert.equal(isPromptExecuting("failed", false), false);
  assert.equal(isPromptExecuting("terminated", false), false);
  assert.equal(isPromptExecuting("active", true), false);
  assert.equal(isPromptExecuting(undefined, false), false);
});

test("locates a manual atom before the executing or mapped atom", () => {
  assert.equal(
    resolveLocateAtomId(
      "harness-model-invoke",
      "harness-tool-call",
      "harness-observation",
    ),
    "harness-model-invoke",
  );
  assert.equal(
    resolveLocateAtomId(
      undefined,
      "harness-tool-call",
      "harness-observation",
    ),
    "harness-tool-call",
  );
  assert.equal(
    resolveLocateAtomId(null, "", "harness-output-commit"),
    "harness-output-commit",
  );
  assert.equal(resolveLocateAtomId(undefined, "", ""), "");
});

test("Live tracking follows the newest executed atom", () => {
  // An absent selection follows automatically.
  assert.equal(isLiveFollowingLatest(undefined, "harness-tool-call"), true);
  // Selecting the newest executed atom keeps Live on it.
  assert.equal(isLiveFollowingLatest("harness-tool-call", "harness-tool-call"), true);
  // Selecting an older atom has left Live mode.
  assert.equal(isLiveFollowingLatest("harness-model-invoke", "harness-tool-call"), false);
  // An empty or cleared selection is not following either.
  assert.equal(isLiveFollowingLatest(null, "harness-tool-call"), false);
  assert.equal(isLiveFollowingLatest("", "harness-tool-call"), false);
});

test("Live tracking exits when newer events leave a pinned atom behind", () => {
  // The user pinned what was the newest atom; a newer event maps elsewhere.
  assert.equal(isLiveFollowingLatest("harness-tool-call", "harness-output-commit"), false);
  // The pulse rides forward with the newest event while still following.
  assert.equal(isLiveFollowingLatest(undefined, "harness-output-commit"), true);
});
