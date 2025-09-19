# Offline HTTP Helper

Offline HTTP Helper is an offline-first networking toolkit that exposes observable-style helpers for making HTTP requests in web and hybrid mobile applications. It automatically queues requests in IndexedDB when users are offline, replays them when connectivity is restored, and notifies consumers about lifecycle events so that UI layers can inform workers about sync progress or failures.

## Key features

- **Observable-style API** – The helper returns light-weight observables inspired by RxJS so callers can compose, subscribe, and transform results.
- **Full HTTP coverage** – Convenience methods for every HTTP verb (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`) backed by a generic `request` method.
- **Offline queue backed by IndexedDB** – Requests made offline (or failing due to connectivity) are serialized, stored, and persisted across application restarts.
- **Automatic replay** – The built-in sync manager replays queued requests as soon as the device is online, with configurable retry and backoff strategies.
- **File and binary payload support** – The serializer understands `FormData`, `Blob`, `ArrayBuffer`, and other binary-friendly body types so uploads are preserved when queued.
- **Event-driven error handling** – Consumers subscribe to events such as `requesterror`, `requestqueued`, and `syncerror` to surface issues in the UI even after an app relaunch.
- **Extensible architecture** – Separate queue, serializer, observable, and sync manager components can be reused independently or replaced in advanced scenarios.

## Installation

```bash
npm install offline-http-helper
```

The package ships TypeScript declarations and ES module output in `dist/`.

## Usage

```ts
import { HttpClient } from 'offline-http-helper';

const client = new HttpClient({
  baseUrl: 'https://api.example.com',
});

// Subscribe to sync lifecycle events once at app bootstrap.
client.eventBus.on('syncerror', (event) => {
  console.warn('Sync failed', event.detail.error, event.detail.request);
});

// Make a POST request that may be queued when offline.
client
  .post('/inspections', { id: '123', completedAt: new Date().toISOString() })
  .subscribe({
    next: (result) => {
      if (result.kind === 'queued') {
        console.log('Stored offline request with id', result.request.id);
      } else {
        console.log('Server responded with', result.response.data);
      }
    },
    error: (err) => {
      console.error('Request failed permanently', err);
    },
  });

// Later, trigger a manual sync (e.g., from a "Sync now" button)
await client.syncNow();
```

### Events

Subscribe to lifecycle events using the exposed `HttpEventBus`:

| Event | Detail payload | Purpose |
| --- | --- | --- |
| `requestqueued` | `{ request }` | Fired whenever a request is persisted for later replay. |
| `requesterror` | `{ error, request }` | Emitted when an online request fails and is **not** queued. Suitable for immediate user feedback. |
| `syncstart` | `{ stats }` | Indicates replay is starting. |
| `syncprogress` | `{ stats, request }` | Optional hook for granular progress updates (emitted by the sync manager). |
| `syncsuccess` | `{ stats, request, response }` | Fired when a replayed request succeeds. |
| `syncerror` | `{ stats, request, error }` | Fired when replay fails. The queue retains the entry (with backoff metadata) for manual recovery. |
| `synccomplete` | `{ stats, remainingRequests }` | Summary emitted after a replay batch finishes. |
| `replayresult` | `{ request, response? , error? }` | Result of manually retrying a failed entry. |

All event payloads contain serializable details so they can be logged or displayed even after app restarts.

### Error handling strategy

Errors are surfaced through events and observable `error` notifications:

- **Network offline** – A `NetworkOfflineError` is emitted to subscribers _only_ when `queueOffline` is disabled; otherwise the request is queued and a `requestqueued` event fires.
- **HTTP status errors** – Wrapped in `NetworkHttpError` (or `ReplayHttpError` during sync) and dispatched via `requesterror` / `syncerror` events with the parsed response body attached as `cause`.
- **Network failures** – When fetch rejects with a network `TypeError`, the helper automatically queues the request (when `queueOnError` is true) and raises `requestqueued`.

### Configuration overview

```ts
const client = new HttpClient({
  baseUrl: 'https://api.example.com',
  defaultOptions: {
    headers: { Authorization: 'Bearer token' },
    queueOffline: true,
    queueOnError: true,
    responseType: 'json',
  },
  offlineQueue: {
    dbName: 'field-ops-queue',
  },
  sync: {
    maxRetries: 10,
    baseRetryDelayMs: 2000,
    backoffMultiplier: 1.5,
    haltOnFailure: false,
  },
});
```

### Manual recovery flows

Consumers can inspect and retry failed entries:

```ts
const sync = client.getSyncManager();
const queue = client.getQueue();

const failed = (await queue.getAll()).filter((item) => item.lastError);

for (const request of failed) {
  const result = await sync.retryErroredRequest({ requestId: request.id });
  if (result?.error) {
    // Still failing – show UI and allow editing metadata or headers before retrying again.
  }
}
```

## Architecture

High-level architecture and sequence diagrams are documented in [`docs/architecture.md`](./docs/architecture.md).

## Development

```bash
npm install
npm run build
```

`npm run build` generates compiled output in `dist/`. Use `npm run lint` to run type-checking without emitting files.

## License

MIT © Offline HTTP Helper contributors

