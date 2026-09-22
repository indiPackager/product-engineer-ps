# Product Engineering Challenge Submission

## Candidate

- **Name:**
- **Email:**
- **GitHub:**
- **Selected problem:** Problem 3: Durable Reminders and Follow-Ups
- **Demo video:**

## Run the project

### Prerequisites

- Node.js 22 or newer
- npm

### Setup and run

```bash
npm install
npm run dev
```

The server starts at `http://localhost:3000`. Reminder data is stored in `data/reminders.json`, which is created automatically when the server starts.

The service exposes these REST operations:

- `POST /api/reminders` creates a reminder with `content`, `localTime`, and `timeZone`.
- `GET /api/reminders/:id` inspects a reminder and its attempt history.
- `PATCH /api/reminders/:id` edits an active reminder and creates a new version.
- `POST /api/reminders/:id/cancel` cancels an active reminder.
- `POST /api/tick` manually triggers one scheduler pass for testing or debugging. The server also runs this work automatically in the background.

### What to try

1. Create a reminder that is already due and fetch it again after a short moment. The background worker should process it automatically, leaving it `delivered` with one attempt.
2. Create a future reminder, change it with `PATCH`, and then cancel it. The response shows the new version and the `cancelled` state.
3. Run `npm test` to see temporary failure recovery, retry exhaustion, duplicate execution, edit and cancellation behavior, and time-zone tests.
4. Run `npm run benchmark` to exercise the larger workflow, including restart recovery and duplicate execution.

For example, this creates a reminder in the `Asia/Kolkata` time zone:

```bash
curl -X POST http://localhost:3000/api/reminders ^
  -H "Content-Type: application/json" ^
  -d "{\"content\":\"Call Sam\",\"localTime\":\"2025-01-01T09:00\",\"timeZone\":\"Asia/Kolkata\"}"
```

The running service uses the system clock. The tests and benchmark inject their own clock, which makes the time-dependent cases quick and repeatable.

## Run the tests

```bash
npm test
```

The current test run passes all 8 tests with no failures.

## Acceptance scenarios and verification

I implemented the required scenarios as follows:

- **AC1 Scheduled delivery:** A background worker calls `poll()` at a fixed interval, finds due reminders, sends them to the destination, changes them to `delivered`, and records the attempt.
- **AC2 Restart recovery:** The server opens the JSON file on startup. A reminder left in `running` state is put back into `scheduled` so it can be processed again.
- **AC3 Temporary failure:** Each failed attempt is kept with its start time, finish time, and error. The reminder is scheduled again until the attempt limit is reached.
- **AC4 Duplicate execution:** Each version has a stable delivery key. `MemoryDestination` ignores a second delivery with the same key.
- **AC5 Edit before execution:** An edit increments the version and creates a new delivery key. The old version cannot commit a delivery after the edit.
- **AC6 Cancellation:** Cancellation is checked before delivery and again before the successful result is committed.
- **AC7 Time-zone boundary:** `Intl.DateTimeFormat` is used with the supplied IANA zone. A nonexistent DST time is rejected, and an ambiguous time consistently selects the earlier instant.

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

The benchmark creates 20 reminders in UTC and Asia/Kolkata. It edits one, cancels one, retries a temporary failure, forces a permanent failure, reopens the stored state, and executes one reminder twice. The run produced 18 delivered reminders and 18 unique logical notifications.

## Architecture and data flow

### Components

1. **HTTP API (`server/app.js`)**
   - Keeps the HTTP layer small. It passes create, inspect, edit, cancel, and tick requests to the scheduler and converts expected failures into useful HTTP responses.

2. **Scheduler (`server/scheduler.js`)**
   - Owns the reminder lifecycle: `scheduled` -> `running` -> `delivered`, `failed`, or `cancelled`.
   - Discovers due work, claims an expected version, records attempts, retries failures, and applies edit/cancel checks.
   - Uses an injectable clock and destination so behavior is deterministic in tests.

3. **Durable storage (`server/storage.js`)**
   - Persists all reminders as JSON using a temporary file followed by rename.
   - Stores schedule data, version, delivery key, attempt history, state, and terminal metadata.

4. **Time conversion (`server/time.js`)**
   - Converts a local wall-clock value plus IANA time zone into a UTC execution instant.
   - Detects nonexistent local times and resolves ambiguous values by choosing the earlier instant.

5. **Local destination (`MemoryDestination`)**
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
- **Express:** Provides a small HTTP layer without hiding the scheduler behavior.
- **JSON file storage:** Appropriate for this single-process exercise, while still proving restart durability without a database setup burden.
- **`Intl.DateTimeFormat`:** Uses the runtime's IANA time-zone data instead of maintaining a custom offset table.
- **Node's built-in test runner:** Keeps tests dependency-light and supports deterministic injected-clock tests.

The main trade-off is that JSON storage and in-process polling keep the project easy to run, but they are not enough for multiple workers. A multi-worker version would need atomic claims and shared storage.

## Important decisions

1. **Versioned occurrences:** An edit increments `version` and creates a new `deliveryKey`. The scheduler receives the expected version and refuses to commit an old version after an edit or cancellation.

2. **Idempotency at the destination boundary:** The destination checks the stable delivery key before adding a notification. Calling `execute()` twice therefore does not create two logical notifications for the same occurrence.

3. **Deterministic local-time policy:** Valid local times are converted using IANA rules. A nonexistent DST time is rejected rather than silently moved. If a time occurs twice during the fall-back transition, the earlier instant is used.

4. **Bounded retry policy:** The prototype treats destination errors as retryable and stops after three attempts by default. The normal delay is one second; tests set the delay to zero so they do not wait.

5. **Edit and cancellation race:** The reminder is read again before delivery and before the successful result is saved. Within this single process, a newer version or cancellation wins the final state.

## Assumptions and limitations

- The prototype uses one Node.js process and a local JSON file. Multiple workers could claim the same item without an atomic compare-and-set or file lock.
- The notification destination is an in-memory fake; no email, SMS, push, or calendar provider is used.
- Schedules are one-time only. Recurrence and natural-language date parsing are out of scope.
- The server uses the system clock and an in-process worker loop. `POST /api/tick` remains available as a manual test hook. A production system would use a durable worker queue or workflow engine.
- All destination errors currently share the same bounded retry policy. A production integration should classify retryable versus permanent errors explicitly.
- The demo video link still needs to be added above after recording.

## Production and scale

The first production change would be replacing the JSON file with a transactional database and claiming work with an atomic state/version update. After that, I would add a shared queue for multiple workers, leases for in-flight work, and a real notification provider with idempotency keys. Metrics, structured logs, dead-letter handling, authentication, and graceful shutdown would follow.

The submitted implementation currently provides single-process durable state, restart recovery, deterministic time conversion, bounded retries, and local idempotency; these production changes are proposed extensions rather than claimed features.

## AI usage

I used AI coding assistance while working on this submission to inspect the challenge, discuss design options, and review parts of the implementation and documentation. I checked the code against the Problem 3 requirements and ran the tests and benchmark locally. No external notification service or secret is used.

## Credibility note

- **Problem solved:**
- **Personal contribution:**
- **Scale or operational complexity:**
- **Difficult engineering or product decision:**
- **Public evidence:**

Candidate-specific details should be completed before submission.
