import { randomUUID } from "node:crypto";
import { localTimeToInstant } from "./time.js";

const activeStates = new Set(["scheduled", "running"]);

export class Scheduler {
  constructor({
    storage,
    destination,
    clock = () => new Date(),
    maxAttempts = 3,
    retryDelayMs = 1000,
  }) {
    this.storage = storage;
    this.destination = destination;
    this.clock = clock;
    this.maxAttempts = maxAttempts;
    this.retryDelayMs = retryDelayMs;
  }

  async create({ content, localTime, timeZone }) {
    const dueAt = localTimeToInstant(localTime, timeZone).toISOString();
    const id = randomUUID();
    return this.storage.insert({
      id,
      content,
      localTime,
      timeZone,
      dueAt,
      version: 1,
      state: "scheduled",
      attempts: [],
      deliveryKey: `${id}:1`,
      nextAttemptAt: dueAt,
    });
  }

  get(id) {
    return this.storage.get(id);
  }

  async edit(id, changes) {
    const current = this.get(id);
    if (!current || !activeStates.has(current.state)) return null;
    const localTime = changes.localTime ?? current.localTime;
    const timeZone = changes.timeZone ?? current.timeZone;
    const dueAt = localTimeToInstant(localTime, timeZone).toISOString();
    const version = current.version + 1;
    return this.storage.update(id, {
      content: changes.content ?? current.content,
      localTime,
      timeZone,
      dueAt,
      version,
      state: "scheduled",
      deliveryKey: `${id}:${version}`,
      nextAttemptAt: dueAt,
    });
  }

  async cancel(id) {
    const current = this.get(id);
    if (!current || !activeStates.has(current.state)) return null;
    return this.storage.update(id, {
      state: "cancelled",
      cancelledAt: this.clock().toISOString(),
    });
  }

  async recover() {
    for (const reminder of this.storage.list()) {
      if (reminder.state === "running") {
        await this.storage.update(reminder.id, {
          state: "scheduled",
          nextAttemptAt: this.clock().toISOString(),
        });
      }
    }
  }

  async poll() {
    const now = this.clock();
    const due = this.storage
      .list()
      .filter(
        (reminder) =>
          reminder.state === "scheduled" &&
          new Date(reminder.nextAttemptAt) <= now,
      );
    for (const reminder of due)
      await this.execute(reminder.id, reminder.version);
  }

  async execute(id, expectedVersion = this.get(id)?.version) {
    const current = this.get(id);
    if (
      !current ||
      current.version !== expectedVersion ||
      !activeStates.has(current.state)
    )
      return this.get(id);
    await this.storage.update(id, { state: "running" });
    const claimed = this.get(id);
    const attempt = {
      number: claimed.attempts.length + 1,
      startedAt: this.clock().toISOString(),
    };
    try {
      const latest = this.get(id);
      if (latest.version !== expectedVersion || latest.state === "cancelled")
        return latest;
      const result = await this.destination.deliver({
        id,
        content: latest.content,
        deliveryKey: latest.deliveryKey,
        version: latest.version,
      });
      const committed = this.get(id);
      if (
        committed.version !== expectedVersion ||
        committed.state === "cancelled"
      )
        return committed;
      attempt.finishedAt = this.clock().toISOString();
      attempt.outcome = "delivered";
      return this.storage.update(id, {
        attempts: [...committed.attempts, attempt],
        state: "delivered",
        deliveredAt: attempt.finishedAt,
        destinationId: result?.id ?? null,
      });
    } catch (error) {
      const latest = this.get(id);
      attempt.finishedAt = this.clock().toISOString();
      attempt.outcome = "failed";
      attempt.error = error.message;
      const attempts = [...latest.attempts, attempt];
      const exhausted = attempts.length >= this.maxAttempts;
      return this.storage.update(id, {
        attempts,
        state: exhausted ? "failed" : "scheduled",
        nextAttemptAt: new Date(
          this.clock().getTime() + this.retryDelayMs,
        ).toISOString(),
        error: exhausted ? error.message : undefined,
      });
    }
  }
}

export class MemoryDestination {
  constructor() {
    this.notifications = [];
    this.failures = 0;
    this.temporaryFailures = new Map();
    this.permanentFailures = new Set();
  }

  async deliver(notification) {
    if (this.permanentFailures.has(notification.id)) {
      throw new Error("permanent destination failure");
    }
    const remainingFailures = this.temporaryFailures.get(notification.id) ?? 0;
    if (remainingFailures > 0) {
      this.temporaryFailures.set(notification.id, remainingFailures - 1);
      throw new Error("temporary destination failure");
    }
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("temporary destination failure");
    }
    if (
      !this.notifications.some(
        (item) => item.deliveryKey === notification.deliveryKey,
      )
    ) {
      this.notifications.push({ ...notification, id: randomUUID() });
    }
    return this.notifications.at(-1);
  }
}
