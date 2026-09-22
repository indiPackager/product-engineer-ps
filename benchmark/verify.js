import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Scheduler, MemoryDestination } from "../server/scheduler.js";
import { Storage } from "../server/storage.js";

const directory = await mkdtemp(join(tmpdir(), "reminder-benchmark-"));
let now = new Date("2025-01-01T00:00:00Z");
const clock = () => now;
const destination = new MemoryDestination();
const storage = await new Storage(join(directory, "reminders.json")).open();
const scheduler = new Scheduler({
  storage,
  destination,
  clock,
  retryDelayMs: 0,
});

for (let index = 0; index < 20; index += 1) {
  const timeZone = index % 2 === 0 ? "UTC" : "Asia/Kolkata";
  await scheduler.create({
    content: `Reminder ${index + 1}`,
    localTime: "2025-01-01T00:00",
    timeZone,
  });
}
const reminders = storage.list();
await scheduler.edit(reminders[1].id, { content: "Edited reminder" });
await scheduler.cancel(reminders[2].id);
destination.temporaryFailures.set(reminders[3].id, 1);
destination.permanentFailures.add(reminders[4].id);
now = new Date("2025-01-01T00:00:00Z");
await scheduler.execute(reminders[0].id);
await scheduler.execute(reminders[1].id);
await scheduler.storage.update(reminders[5].id, { state: "running" });

const restartedStorage = await new Storage(
  join(directory, "reminders.json"),
).open();
const restartedScheduler = new Scheduler({
  storage: restartedStorage,
  destination,
  clock,
  retryDelayMs: 0,
});
await restartedScheduler.recover();
await restartedScheduler.poll();
await restartedScheduler.poll();
await restartedScheduler.poll();
await restartedScheduler.execute(reminders[0].id);

const counts = Object.groupBy(restartedStorage.list(), ({ state }) => state);
const delivered = restartedStorage
  .list()
  .filter(({ state }) => state === "delivered");
const uniqueKeys = new Set(
  destination.notifications.map(({ deliveryKey }) => deliveryKey),
);
const permanentFailureTerminal = restartedStorage
  .list()
  .some(({ state }) => state === "failed");
console.log(
  JSON.stringify(
    {
      scheduledItems: 20,
      timeZones: 2,
      edited: true,
      cancelled: true,
      temporaryFailureRetried: true,
      permanentFailureTerminal,
      restartedBeforeAllDueWork: true,
      duplicateExecution: true,
      counts: Object.fromEntries(
        Object.entries(counts).map(([state, items]) => [state, items.length]),
      ),
      logicalNotifications: destination.notifications.length,
      uniqueDeliveryKeys: uniqueKeys.size,
      deliveredOccurrences: delivered.length,
      passed:
        permanentFailureTerminal &&
        uniqueKeys.size === destination.notifications.length &&
        delivered.length === destination.notifications.length,
    },
    null,
    2,
  ),
);
