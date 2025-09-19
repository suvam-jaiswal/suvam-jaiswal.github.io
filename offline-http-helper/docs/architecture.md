# Architecture

## Component overview

```mermaid
flowchart LR
  subgraph ClientApp[Client Application]
    UI[UI / Feature Modules]
    Worker[Background Sync Trigger]
  end

  subgraph Library[offline-http-helper]
    HttpClient --> HttpObservable
    HttpClient --> EventBus
    HttpClient --> Queue
    HttpClient --> Serializer
    Queue --> IndexedDB[(IndexedDB)]
    SyncManager --> Queue
    SyncManager --> EventBus
    SyncManager --> Fetcher[(Fetch API)]
  end

  UI -->|subscribe| EventBus
  UI -->|call request()| HttpClient
  Worker -->|syncNow()| SyncManager
```

The `HttpClient` composes request execution, offline detection, serialization, and event dispatching. The `HttpSyncManager` processes queued entries (either automatically on the browser `online` event or manually) and emits progress and error events back through the shared `HttpEventBus`.

## Offline request lifecycle

```mermaid
sequenceDiagram
  participant UI as Feature Module
  participant Client as HttpClient
  participant Queue as OfflineQueue
  participant DB as IndexedDB
  participant Sync as HttpSyncManager
  participant API as Remote API

  UI->>Client: post('/inspections', payload)
  Client->>Client: detect offline
  Client->>Queue: enqueue(serialized request)
  Queue->>DB: persist request
  Queue-->>Client: queued request id
  Client-->>UI: Observable next({ kind: 'queued' })
  Client-->>UI: Event requestqueued
  ... Later, device comes online ...
  Sync->>Queue: getAll()
  Queue-->>Sync: pending requests
  loop per request
    Sync->>API: fetch(serialized request)
    alt success
      API-->>Sync: response
      Sync->>Queue: remove(id)
      Sync-->>UI: syncsuccess event with HttpResponse
    else failure
      API-->>Sync: error response
      Sync->>Queue: update(error, attempts, backoff)
      Sync-->>UI: syncerror event
    end
  end
  Sync-->>UI: synccomplete event
```

## Failure and recovery strategy

- Failed sync attempts are recorded with exponential backoff metadata (`attempts`, `nextAttemptAt`, `lastError`).
- Requests exceeding the configured retry limit remain in the queue but stop auto-retrying, allowing operators to inspect and fix issues.
- `HttpSyncManager.retryErroredRequest` enables manual recovery flows (e.g., after editing headers or payloads) without dropping context.
- All error notifications are dispatched through events so the UI can survive tab reloads or app relaunches.

