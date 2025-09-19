# Offline HTTP Client

An Observable-inspired HTTP helper that transparently queues network requests in IndexedDB when offline and replays them once the device regains connectivity. Designed for field applications where work is performed offline during the day and synchronised when workers return online.

## Features

- 📡 Observable-style API (`client.request(...).subscribe(...)`) with helpers for common HTTP verbs.
- 📦 Automatic persistence of queued requests in IndexedDB, including JSON payloads, file uploads, and form data.
- 🔁 Configurable retry strategies (exponential, linear, fixed) with back-off and event notifications.
- 🧩 Event-driven lifecycle: consumers subscribe to `queue:added`, `sync:success`, `sync:error`, `sync:retry`, `sync:failed`, and `queue:drain` to update UI or trigger compensating flows.
- 🧾 Persisted event log so applications can recover state after restarts and surface historical sync errors to users.
- ♻️ Manual recovery APIs for inspecting pending/failed requests and re-queuing failures.

## Installation

```bash
npm install offline-http-client
```

The package ships ESM output (`dist/`) and TypeScript declarations.

## Quick start

```ts
import { OfflineHttpClient } from 'offline-http-client';

const client = new OfflineHttpClient({
  defaultRetries: 5,
  defaultRetryDelay: 2000,
});

client.events.on('sync:error', ({ detail }) => {
  // Persist to UI state, notify the user, etc.
  console.error('Sync failed', detail);
});

client
  .post('https://api.example.com/work-logs', {
    entries: [{ id: 'task-1', status: 'done' }],
  })
  .subscribe({
    next: (result) => {
      if (result.status === 'queued') {
        console.log('Saved offline with id', result.id);
      } else {
        console.log('Server acknowledged', result.data);
      }
    },
    error: (err) => console.error('Immediate failure', err),
  });
```

### Handling files and form data

```ts
const formData = new FormData();
formData.append('metadata', JSON.stringify({ siteId: 'A12' }));
formData.append('photo', fileInput.files[0]);

client.post('https://api.example.com/uploads', formData, {
  responseType: 'json',
});
```

Binary payloads are stored as `Blob`s inside IndexedDB to avoid lossy serialisation.

### Recovering from sync failures

```ts
const failed = await client.getFailedRequests();
// Show failed items in the UI and allow users to retry selected ones
await client.retryFailed(failed.map((req) => req.id));
```

The event log is persisted so applications reopening later can inspect prior sync attempts:

```ts
const events = await client.getEventHistory();
for (const event of events) {
  // Render event.detail to give operators context about what happened.
}
```

## Event reference

| Event            | Payload summary |
| ---------------- | --------------- |
| `queue:added`    | Request persisted offline. |
| `sync:success`   | Request replayed successfully with parsed response payload. |
| `sync:error`     | Sync failed (network or HTTP) and may retry. |
| `sync:retry`     | Retry scheduled with delay in milliseconds. |
| `sync:failed`    | Terminal failure (HTTP non-OK or retries exhausted). |
| `queue:drain`    | Queue processing completed with `remaining` count. |

> ⚠️ Errors are **always** surfaced via events so that applications reopened later can reconstruct state. Observers attached to the original request receive `error` notifications only for immediate, online failures.

## Offline workflow

1. When the device is offline (determined via `navigator.onLine`) requests are serialised and stored in IndexedDB.
2. Each stored request tracks retry metadata (strategy, attempt count, last error, metadata).
3. The client listens for the browser `online` event and resumes processing. Requests are replayed oldest-first.
4. Responses are parsed according to the original `responseType`, persisted to the event log, and surfaced to listeners.
5. Failures trigger retries using the selected strategy. Once retry attempts are exhausted, the request remains flagged as `failed` for manual recovery.

Refer to [`docs/architecture.md`](docs/architecture.md) for diagrams of the data flow and offline/online state machine.

## Building from source

```bash
npm install
npm run build
```

The build emits ESM into `dist/` with accompanying `.d.ts` files.

## License

MIT
