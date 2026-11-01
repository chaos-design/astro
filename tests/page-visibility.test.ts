import assert from "node:assert/strict";
import test from "node:test";
import {
  PAGE_SUSPEND_AFTER_HIDDEN_MS,
  createPageVisibilityMonitor,
  type PageVisibilitySource,
} from "../src/lib/page-visibility.ts";

class FakeDocument extends EventTarget implements PageVisibilitySource {
  visibilityState = "visible";

  setVisible(visible: boolean) {
    this.visibilityState = visible ? "visible" : "hidden";
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("exposes a long enough suspension delay", () => {
  assert.equal(PAGE_SUSPEND_AFTER_HIDDEN_MS, 30_000);
});

test("a quick tab switch keeps live work running", async () => {
  const doc = new FakeDocument();
  const monitor = createPageVisibilityMonitor(doc, 20);
  monitor.subscribe(() => {});

  doc.setVisible(false);
  await wait(5);
  doc.setVisible(true);
  await wait(30);

  const snapshot = monitor.getSnapshot();
  assert.equal(snapshot.hidden, false);
  assert.equal(snapshot.suspended, false);
  assert.equal(snapshot.resumeCount, 0);
});

test("a long hidden period suspends and the next visit resumes once", async () => {
  const doc = new FakeDocument();
  const monitor = createPageVisibilityMonitor(doc, 10);
  let notifications = 0;
  monitor.subscribe(() => {
    notifications += 1;
  });

  doc.setVisible(false);
  await wait(40);
  assert.equal(monitor.getSnapshot().hidden, true);
  assert.equal(monitor.getSnapshot().suspended, true);

  doc.setVisible(true);
  await wait(20);
  const resumed = monitor.getSnapshot();
  assert.equal(resumed.hidden, false);
  assert.equal(resumed.suspended, false);
  assert.equal(resumed.resumeCount, 1);
  // hidden, suspended, visible: one notification per transition, not per tick.
  assert.equal(notifications, 3);

  doc.setVisible(false);
  await wait(5);
  doc.setVisible(true);
  await wait(20);
  assert.equal(monitor.getSnapshot().resumeCount, 1);
});

test("stops observing once the last subscriber leaves", async () => {
  const doc = new FakeDocument();
  const monitor = createPageVisibilityMonitor(doc, 5);
  const unsubscribe = monitor.subscribe(() => {});
  unsubscribe();

  doc.setVisible(false);
  await wait(20);

  const snapshot = monitor.getSnapshot();
  assert.equal(snapshot.hidden, false);
  assert.equal(snapshot.suspended, false);
});

test("a console opened in a background tab suspends without a transition", async () => {
  const doc = new FakeDocument();
  doc.visibilityState = "hidden";
  const monitor = createPageVisibilityMonitor(doc, 5);

  monitor.subscribe(() => {});
  await wait(20);
  assert.equal(monitor.getSnapshot().suspended, true);

  doc.setVisible(true);
  assert.equal(monitor.getSnapshot().resumeCount, 1);
});
