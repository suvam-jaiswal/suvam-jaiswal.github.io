# Offline HTTP Helper

An offline-first HTTP helper toolkit inspired by RxJS semantics. It wraps the Fetch API, automatically queues requests while offline, persists them in IndexedDB, and replays them once connectivity is restored. Consumers receive lifecycle updates through DOM events instead of callbacks, ensuring that error and success notifications survive application restarts.

## Features

- Observable-like API for all HTTP methods (`get`, `post`, `put`, `patch`, `delete`, `options`, `head`, and a low-level `request`).
- Automatic offline detection with configurable background polling.
- IndexedDB-backed queue for pending requests, including file uploads and complex `FormData` payloads.
- Retry policy with dead-letter queue once max retries are exhausted.
- Event-driven communication (`request:queued`, `request:success`, `request:error`, `request:permanent-failure`, `sync:*`).
- Utilities to inspect queued and failed requests and to manually trigger sync.

## Installation

```bash
npm install offline-http-helper
```

> The library is distributed as ESM and CommonJS bundles with TypeScript definitions. Build the project locally via `npm run build`.

## Quick Start

```ts
import { HttpClient } from 'offline-http-helper';

const client = new HttpClient({
  baseUrl: 'https://api.example.com',
  maxRetries: 5,
});

// Listen to lifecycle events (persists across app reloads)
client.on({
  'request:queued': ({ detail }) => {
    console.info('Queued request', detail.request.id);
  },
  'request:error': ({ detail }) => {
    if (detail.error.retriable) {
      console.warn('Retrying soon', detail.error.requestId);
    } else {
      console.error('Permanent failure', detail.error.requestId);
    }
  },
  'sync:completed': ({ detail }) => {
    console.log('Sync finished', detail.stats);
  },
});

// Fire-and-forget uploads
client
  .post('/jobs/123/photos', fileBlob, {
    headers: { 'Content-Type': fileBlob.type },
    metadata: { jobId: 123 },
  })
  .subscribe({
    next: ({ queued, requestId }) => {
      if (queued) {
        console.log('Stored offline', requestId);
      } else {
        console.log('Uploaded immediately', requestId);
      }
    },
    error: (error) => {
      console.error('Immediate failure', error);
    },
  });
```

## Handling Sync Failures

1. Register an event listener for `request:permanent-failure` to surface actionable alerts in your UI.
2. Use `client.listDeadLetters()` to render a retry screen when the worker returns online.
3. Once the issue is fixed (e.g., validation error corrected), resubmit using the original payload or a modified one and call `client.triggerSync()`.

## IndexedDB Data Model

| Store | Purpose |
| ----- | ------- |
| `queue` | Pending requests awaiting replay. |
| `dead-letter` | Requests that exceeded the retry threshold. |

Each record stores the serialized request body, metadata, retry attempts, and timestamps so that replay is deterministic.

## Architecture

See [docs/architecture.md](docs/architecture.md) for component, sequence, and error propagation diagrams.

## Development

```bash
npm install
npm run build
```

The build command bundles the TypeScript sources into ESM/CJS outputs and generates type declarations.
