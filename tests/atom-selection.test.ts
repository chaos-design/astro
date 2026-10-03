import assert from "node:assert/strict";
import test from "node:test";
import {
  isFollowingLive,
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
