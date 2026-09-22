# Product Engineering Challenge Submission

## Candidate

- **Name:**
- **Email:**
- **GitHub:**
- **Selected problem:** Problem 3: Durable Reminders and Follow-Ups

## Run the project

### Prerequisites

- Node.js 22 or newer
- npm

### Setup and run

```bash
npm install
npm run dev
```

The server starts at `http://localhost:3000` and stores reminder state in `data/reminders.json`.

The service exposes these REST operations:

- `POST /api/reminders` creates a reminder with `content`, `localTime`, and `timeZone`.
- `GET /api/reminders/:id` inspects a reminder and its attempt history.
- `PATCH /api/reminders/:id` edits an active reminder and creates a new version.
- `POST /api/reminders/:id/cancel` cancels an active reminder.
- `POST /api/tick` discovers and processes due work.

### Scenarios to trigger

1. **Successful delivery:** Create a reminder whose `localTime` is already due in its selected time zone, then call `POST /api/tick`. Fetch the reminder and verify `state` is `delivered` with one recorded attempt.
2. **Edit and cancellation:** Create a future reminder, edit its content or time with `PATCH`, then cancel it with `POST /api/reminders/:id/cancel`. Verify the version increased and no notification is delivered after polling.
3. **Retry and terminal failure:** Run `npm test` to exercise a temporary destination failure followed by success and a permanent failure reaching the bounded `failed` state.
4. **Restart recovery and duplicate execution:** Run `npm run benchmark`. It simulates an in-progress item across a storage reopen and executes one occurrence twice; the result reports one logical notification for that delivery key.

Example:

```bash
curl -X POST http://localhost:3000/api/reminders ^
  -H "Content-Type: application/json" ^
  -d "{\"content\":\"Call Sam\",\"localTime\":\"2025-01-01T09:00\",\"timeZone\":\"Asia/Kolkata\"}"
```

The service uses the system clock in normal operation. The automated tests and benchmark inject a clock so time-dependent behavior is deterministic and does not wait in real time.

## Run the tests

```bash
npm test
```

Observed result: **7 tests passed, 0 failed**.

## Acceptance scenarios and verification

The implementation covers the required Problem 3 scenarios:

- **AC1 Scheduled delivery:** Due scheduled work is discovered by `poll()`, delivered to the local destination, marked `delivered`, and recorded with an attempt and destination id.
- **AC2 Restart recovery:** JSON state is reopened on startup. Reminders left in `running` state are returned to `scheduled` and become eligible for polling again.
- **AC3 Temporary failure:** Failed attempts are recorded with timestamps and error messages. The reminder is rescheduled using the configured delay until the bounded attempt limit is reached.
- **AC4 Duplicate execution:** The delivery boundary uses the stable `deliveryKey` (`reminder id:version`) and stores at most one logical notification for that key.
- **AC5 Edit before execution:** Editing increments the version, recalculates the execution instant, replaces the delivery key, and prevents the superseded version from being delivered.
- **AC6 Cancellation:** Cancellation changes an active reminder to `cancelled`. Polling and execution re-check state and version before committing delivery.
- **AC7 Time-zone boundary:** IANA zones are converted with `Intl.DateTimeFormat`. Nonexistent local times, such as a spring-forward gap, are rejected. Ambiguous local times choose the earlier matching instant deterministically.

### Verification benchmark

Run:

```bash
npm run benchmark
```

Observed result:

```text
scheduledItems: 20
 timeZones: 2
 edited: true
 cancelled: true
 temporaryFailureRetried: true
 permanentFailureTerminal: true
 restartedBeforeAllDueWork: true
 duplicateExecution: true
 counts: delivered 18, cancelled 1, failed 1
 logicalNotifications: 18
 uniqueDeliveryKeys: 18
 deliveredOccurrences: 18
 passed: true
```

The benchmark creates 20 items in UTC and Asia/Kolkata, edits and cancels items, injects temporary and permanent failures, simulates a running item during restart recovery, advances the injected clock, and executes one occurrence twice. The 18 delivered occurrences produce 18 unique logical notifications.

## Architecture and data flow

### Components

1. **HTTP API (`server/app.js`)**
   - Maps REST operations to scheduler methods and returns validation or conflict responses.
   - Returns reminder state and conflict or validation responses.

2. **Scheduler (`server/scheduler.js`)**
   - Owns the reminder lifecycle: `scheduled` -> `running` -> `delivered`, `failed`, or `cancelled`.
   - Discovers due work, claims an expected version, records attempts, retries failures, and applies edit/cancel checks.
   - Uses an injectable clock and destination so behavior is deterministic in tests.

3. **Durable storage (`server/storage.js`)**
   - Persists all reminders as JSON using a temporary file followed by rename.
   - Stores schedule data, version, delivery key, attempt history, state, and terminal metadata.

4. **Time conversion (`server/time.js`)
   - Converts a local wall-clock value plus IANA time zone into a UTC execution instant.
   - Detects nonexistent local times and resolves ambiguous values by choosing the earlier instant.

5. **Local destination (`MemoryDestination`)
   - Acts as a deterministic notification provider for the prototype.
   - Enforces idempotency by delivery key and supports injected temporary or permanent failures.

```text
Client
  |
  | REST create/edit/cancel/tick
  v
HTTP API -> Scheduler -> Durable JSON storage
                  |
                  +-> Time-zone conversion
                  +-> MemoryDestination
                  +-> Attempt history and terminal state
```

## Technology choices

- **Node.js with ES modules:** Keeps the service small, runnable, and easy to inspect.
- **Express:** Provides a minimal HTTP layer for the REST contract without hiding scheduler behavior.
- **JSON file storage:** Appropriate for this single-process exercise, while still proving restart durability without a database setup burden.
- **`Intl.DateTimeFormat`:** Uses the runtime's IANA time-zone data instead of maintaining a custom offset table.
- **Node's built-in test runner:** Keeps tests dependency-light and supports deterministic injected-clock tests.

The main trade-off is that JSON storage and in-process polling are intentionally simple and are not suitable for multiple workers without stronger locking and a shared durable store.

## Important decisions

1. **Versioned occurrences:** Every edit increments `version` and derives a new `deliveryKey`. Execution receives an expected version and refuses to commit if the reminder was edited or cancelled meanwhile.

2. **Persist before terminal state:** Attempt history and reminder state are written to storage as part of each delivery outcome. The local destination also deduplicates by the stable occurrence key, protecting against repeated execution calls.

3. **Deterministic local-time policy:** Valid local times map to an instant using IANA rules. A nonexistent DST time is rejected instead of silently shifting. If a local time is ambiguous during a fall-back transition, the earlier matching instant is selected.

4. **Bounded retry policy:** Every destination error is treated as retryable for the prototype. The default limit is three attempts, with a one-second delay. Tests use a zero delay through dependency injection.

5. **Single-worker race boundary:** Execution re-reads the reminder before delivery and before committing the result. This gives deterministic edit/cancel behavior within the single process: a newer version or cancellation wins the final commit, while the destination's stable key prevents duplicate logical delivery.

## Assumptions and limitations

- The prototype uses one Node.js process and a local JSON file. Multiple workers could claim the same item without an atomic compare-and-set or file lock.
- The notification destination is an in-memory fake; no email, SMS, push, or calendar provider is used.
- Schedules are one-time only. Recurrence and natural-language date parsing are out of scope.
- The normal server uses the system clock and a manual `POST /api/tick`; a production system would use a durable worker loop or workflow engine.
- All destination errors currently share the same bounded retry policy. A production integration should classify retryable versus permanent errors explicitly.
- No demo video has been recorded yet.

## Production and scale

First, replace JSON storage with a transactional database and claim due work using an atomic state/version update. Add a shared queue or workflow engine for multiple workers, durable locks or leases for in-flight work, and a real notification adapter with provider idempotency keys. Add structured logs, metrics for due lag and retry counts, dead-letter handling, authentication, and a worker loop with graceful shutdown.

The submitted implementation currently provides single-process durable state, restart recovery, deterministic time conversion, bounded retries, and local idempotency; these production changes are proposed extensions rather than claimed features.

## AI usage

AI coding assistance was used to inspect the challenge and reference repository, reason about the scheduler design, draft implementation changes, and prepare documentation. The resulting code and documentation were reviewed against the Problem 3 contract, and the test suite and benchmark were run locally. No external notification service or secret was used.

## Credibility note

- **Problem solved:**
- **Personal contribution:**
- **Scale or operational complexity:**
- **Difficult engineering or product decision:**
- **Public evidence:**

Candidate-specific details should be completed before submission.
