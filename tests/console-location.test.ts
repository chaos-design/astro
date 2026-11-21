import assert from "node:assert/strict";
import test from "node:test";
import { buildConsoleLocationSearch } from "../src/lib/console-location.ts";

test("switching agent drops the old session and event deep link", () => {
  const search = buildConsoleLocationSearch({
    search: "?agent=chatgpt&session=old-1&event=old-event&api=http%3A%2F%2F127.0.0.1%3A5678",
    agentId: "claude",
  });

  assert.equal(
    search,
    "?agent=claude&api=http%3A%2F%2F127.0.0.1%3A5678",
  );
});

test("the new run's position is restored with only its own event", () => {
  const search = buildConsoleLocationSearch({
    search: "?agent=claude",
    agentId: "claude",
    sessionId: "new-1",
    eventId: "new-event",
    eventIds: new Set(["new-event"]),
  });

  assert.equal(search, "?agent=claude&session=new-1&event=new-event");
});

test("an event outside the open run is not written", () => {
  const search = buildConsoleLocationSearch({
    search: "?agent=claude&session=new-1&event=old-event",
    agentId: "claude",
    sessionId: "new-1",
    eventId: "old-event",
    eventIds: new Set(["new-event"]),
  });

  assert.equal(search, "?agent=claude&session=new-1");
});

test("the legacy source parameter is replaced, not accumulated", () => {
  const search = buildConsoleLocationSearch({
    search: "?source=chatgpt&session=old-1",
    agentId: "others",
  });

  assert.equal(search, "?agent=others");
});
