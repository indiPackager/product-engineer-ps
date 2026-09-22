import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Scheduler, MemoryDestination } from "../server/scheduler.js";
import { Storage } from "../server/storage.js";
import { localTimeToInstant } from "../server/time.js";

async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "durable-reminders-"));
  let now = new Date("2025-01-01T00:00:00.000Z");
  const clock = () => now;
  const storage = await new Storage(join(directory, "reminders.json")).open();
  const destination = new MemoryDestination();
  const scheduler = new Scheduler({
    storage,
    destination,
    clock,
    retryDelayMs: 0,
    ...options,
  });
  return {
    scheduler,
    storage,
    destination,
    setNow: (value) => {
      now = new Date(value);
    },
  };
}

test("discovers due work and delivers once", async () => {
  const { scheduler, destination, setNow } = await fixture();
  const reminder = await scheduler.create({
    content: "Call Sam",
    localTime: "2025-01-01T01:00",
    timeZone: "UTC",
  });
  setNow("2025-01-01T01:00:00Z");
  await scheduler.poll();
  assert.equal(scheduler.get(reminder.id).state, "delivered");
  assert.equal(destination.notifications.length, 1);
});

test("recovers a running reminder after restart", async () => {
  const first = await fixture();
  const reminder = await first.scheduler.create({
    content: "Restart me",
    localTime: "2025-01-01T00:00",
    timeZone: "UTC",
  });
  await first.storage.update(reminder.id, { state: "running" });
  const second = await fixture();
  second.storage.state = first.storage.state;
  await second.scheduler.recover();
  assert.equal(second.scheduler.get(reminder.id).state, "scheduled");
});

test("retries a temporary failure and records both attempts", async () => {
  const { scheduler, destination, setNow } = await fixture({ maxAttempts: 3 });
  destination.failures = 1;
  const reminder = await scheduler.create({
    content: "Retry me",
    localTime: "2025-01-01T00:00",
    timeZone: "UTC",
  });
  setNow("2025-01-01T00:00:00Z");
  await scheduler.poll();
  await scheduler.poll();
  assert.equal(scheduler.get(reminder.id).state, "delivered");
  assert.equal(scheduler.get(reminder.id).attempts.length, 2);
});

test("moves to failed after bounded retries", async () => {
  const { scheduler, destination, setNow } = await fixture({ maxAttempts: 2 });
  destination.failures = 5;
  const reminder = await scheduler.create({
    content: "Fail me",
    localTime: "2025-01-01T00:00",
    timeZone: "UTC",
  });
  setNow("2025-01-01T00:00:00Z");
  await scheduler.poll();
  await scheduler.poll();
  assert.equal(scheduler.get(reminder.id).state, "failed");
  assert.equal(scheduler.get(reminder.id).attempts.length, 2);
});

test("deduplicates repeated execution by delivery key", async () => {
  const { scheduler, destination, setNow } = await fixture();
  const reminder = await scheduler.create({
    content: "Only once",
    localTime: "2025-01-01T00:00",
    timeZone: "UTC",
  });
  setNow("2025-01-01T00:00:00Z");
  await scheduler.execute(reminder.id);
  await scheduler.execute(reminder.id);
  assert.equal(destination.notifications.length, 1);
});

test("editing and cancelling replace or suppress delivery", async () => {
  const edited = await fixture();
  const reminder = await edited.scheduler.create({
    content: "Old",
    localTime: "2025-01-01T00:00",
    timeZone: "UTC",
  });
  const updated = await edited.scheduler.edit(reminder.id, {
    content: "New",
    localTime: "2025-01-02T00:00",
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.deliveryKey, `${reminder.id}:2`);
  const cancelled = await edited.scheduler.cancel(reminder.id);
  assert.equal(cancelled.state, "cancelled");
  await edited.scheduler.poll();
  assert.equal(edited.destination.notifications.length, 0);
});

test("converts multiple IANA zones and rejects a DST gap", () => {
  assert.equal(
    localTimeToInstant("2025-01-01T09:00", "Asia/Kolkata").toISOString(),
    "2025-01-01T03:30:00.000Z",
  );
  assert.equal(
    localTimeToInstant("2025-07-01T09:00", "America/New_York").toISOString(),
    "2025-07-01T13:00:00.000Z",
  );
  assert.throws(
    () => localTimeToInstant("2025-03-09T02:30", "America/New_York"),
    /does not exist/,
  );
});
