# Offline HTTP Helpers

An offline-first HTTP helper toolkit that delivers RxJS-inspired streams for request lifecycles, persists work in IndexedDB, and automatically replays queued operations once a connection is restored.

## Key features

- **Observable-style APIs** – Every helper returns an `HttpStream` that mimics RxJS semantics with `subscribe`, `pipe`, `map`, and `tap` operators.
- **Offline-aware queuing** – Requests issued while offline are serialized and persisted in IndexedDB. The helpers replay them when the device regains connectivity.
- **Durable sync loop** – A `SyncCoordinator` drains the queue, retries with configurable back-off, and emits lifecycle events that remain available after the app restarts.
- **Universal payload support** – JSON payloads, `FormData`, `Blob`/`File`, `ArrayBuffer`, and `URLSearchParams` bodies are preserved across sessions. Files are kept as binary blobs so uploads survive restarts.
- **Event-driven error reporting** – Consumers subscribe to strongly-typed events instead of ephemeral callbacks. Errors expose whether they will be retried so UI layers can react or prompt for manual recovery.
- **Manual controls** – Inspect, retry, or drop queued work programmatically for custom recovery flows.

## Installation

```bash
npm install offline-http-helpers
```

Build the project locally:

```bash
npm install
npm run build
```

The compiled artifacts live under `dist/` (both ESM and CJS modules plus type definitions).

## Quick start

```ts
import { OfflineHttpClient } from 'offline-http-helpers';

const client = new OfflineHttpClient({
  dbName: 'fieldwork-sync',
  retryDelays: [1000, 5000, 15000],
});

// Listen to durable events (survive app restarts once the queue replays)
const stop = client.events.on('request:sync-error', (event) => {
  const { request, error, willRetry } = event.detail;
  console.warn('Sync failed', request.id, error.message, { willRetry });
});

// Issue a request just like an RxJS Observable
client
  .post('https://api.example.com/report', {
    body: { completedAt: new Date().toISOString(), notes: 'Worked offline all day' },
  })
  .subscribe({
    next: (event) => {
      if (event.type === 'scheduled') {
        console.log('Queued offline', event.requestId);
      }
      if (event.type === 'response') {
        console.log('Immediate response', event.data);
      }
    },
    error: (event) => {
      console.error('Fatal error', event.error);
    },
    complete: () => console.log('Stream closed'),
  });
```

## Lifecycle events

The `HttpEventHub` emits events on `client.events` and through the exposed `EventTarget`. Every event detail is structured for resilience across app restarts.

| Event | Detail | Purpose |
| --- | --- | --- |
| `request:queued` | `{ request }` | Fired when a request is captured while offline. |
| `request:requeued` | `{ request }` | A request was queued after a failure while online or manually retried. |
| `request:sync-started` | `{ request, attempt }` | A sync cycle picked up a pending request. |
| `request:sync-success` | `{ request, response, data }` | Replay succeeded with the parsed payload. |
| `request:sync-error` | `{ request, error, attempt, willRetry }` | Sync failed. `willRetry` flags automatic retry. |
| `request:failed` | `{ request, error }` | Automatic retries were exhausted. Manual recovery is required. |
| `sync:drain-started` | `{ pending }` | Sync loop started draining the queue. |
| `sync:drain-complete` | `{ pending }` | Sync loop completed (some items may remain if they failed). |

Consumers can subscribe via:

```ts
const unsubscribe = client.events.on('request:failed', (event) => {
  // Show a banner, prompt the user, etc.
});
```

## Recovering from sync failures

1. Listen to `request:failed` and surface actionable UI to the worker.
2. Inspect queued items with `await client.listQueued()`.
3. Decide whether to retry (`client.retry(id)`), modify, or drop (`client.remove(id)`).
4. Optionally store domain-specific recovery metadata in `metadata` when the request is first made.

## Handling binary uploads

The helper persists binary payloads (files, blobs, `FormData`) directly inside IndexedDB. When replaying, the original MIME type, filename, and modification timestamps are restored. That means workers can capture photos or signatures offline, close the app, and have the helper upload them automatically the next time a connection is available.

## Custom response parsing

When replaying, the helper can only rely on metadata stored with the request. Register reusable parsers and refer to them by key:

```ts
client.registerParser('reportSummary', async (response) => {
  const data = await response.json();
  return { id: data.id, status: data.status };
});

client.post('https://api.example.com/report', {
  body: reportPayload,
  responseParserKey: 'reportSummary',
});
```

For ad-hoc immediate requests, you can still pass `parseResponse` (runs immediately when the response returns) but the parser cannot be persisted across app restarts. Prefer the named parser approach for anything that should survive replaying.

## Streaming operators

`HttpStream` instances offer lightweight RxJS-style operators:

```ts
client
  .post('/endpoint', { body: payload })
  .map((event) => ({ ...event, timestamp: Date.now() }))
  .tap((event) => console.log(event))
  .subscribe(...);
```

The stream completes after emitting `scheduled`, `response`, or `retry` events. If you need multi-phase updates for UI, combine helper streams with the global event hub.

## Manual queue management

```ts
// Inspect
const metrics = await client.metrics();
console.log(metrics.pendingRequests.length, 'requests queued');

// Remove
await client.remove(requestId);

// Retry immediately
await client.retry(requestId);
```

## Architecture

Detailed diagrams live in [`docs/architecture.md`](docs/architecture.md). They explain how the queue, event hub, dispatcher, and sync coordinator work together in both online and offline scenarios.

## Testing & checks

This package ships with TypeScript definitions and a `tsup` build pipeline. Run `npm run check` to type-check without emitting artifacts.
