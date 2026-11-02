import assert from "node:assert/strict";
import test from "node:test";
import { isSameEventSequence } from "../src/lib/event-snapshot.ts";

const events = (...ids: string[]) => ids.map((id) => ({ id }));

test("treats the same ids in the same order as the same snapshot", () => {
  assert.equal(isSameEventSequence(events("a", "b", "c"), events("a", "b", "c")), true);
  assert.equal(isSameEventSequence([], []), true);
});

test("the identity check short-circuits without scanning", () => {
  const current = events("a", "b");
  // Same reference: the comparison must not need an id on the objects at all.
  assert.equal(isSameEventSequence(current, current), true);
  assert.equal(isSameEventSequence([{}] as { id?: string }[], events("")), false);
});

test("a grown, shrunk or reordered snapshot is a different one", () => {
  assert.equal(isSameEventSequence(events("a", "b", "c"), events("a", "b")), false);
  assert.equal(isSameEventSequence(events("a", "b"), events("a", "b", "c")), false);
  assert.equal(isSameEventSequence(events("b", "a"), events("a", "b")), false);
});

test("a rewritten event keeps the snapshot equal because ids are stable", () => {
  // Ids are written once and never rewritten by the recorder, so an equal id
  // sequence is the identity the projection relies on.
  const next = [{ id: "a", capturedAt: "2026-11-01T10:00:00.000Z" }];
  const current = [{ id: "a", capturedAt: "2026-11-01T09:00:00.000Z" }];
  assert.equal(isSameEventSequence(next, current), true);
});

test("events without an id never compare equal by accident", () => {
  assert.equal(
    isSameEventSequence([{ id: null }, { id: "b" }], [{ id: "a" }, { id: "b" }]),
    false,
  );
  assert.equal(isSameEventSequence([{ id: undefined }], [{ id: "" }]), false);
});
