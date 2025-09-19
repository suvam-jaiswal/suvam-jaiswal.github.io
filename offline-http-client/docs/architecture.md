# Architecture Overview

## High-level components

```mermaid
graph TD
  A[Application code] -- subscribes --> B[OfflineHttpClient]
  B -- emits --> C[SyncEventBus]
  B -- persists --> D[(IndexedDB: requests store)]
  B -- logs --> E[(IndexedDB: events store)]
  B -- uses --> F[Observable]
  B -- serialises --> G[Serialization helpers]
  D -.replay queue.-> H[Fetch API]
  H --> A
  E -.historical events.-> A
```

## Offline to online flow

```mermaid
stateDiagram-v2
  [*] --> Online
  Online --> Offline: navigator.onLine === false
  Offline --> Queueing: request()
  Queueing --> Offline: stored in IndexedDB
  Offline --> Online: network restored
  Online --> Replaying: processQueue()
  Replaying --> Success: fetch ok
  Replaying --> Retry: network error
  Retry --> Replaying: backoff elapsed
  Retry --> Failed: attempts exhausted
  Success --> Online
  Failed --> Online
```

## Sequence: offline request replay

```mermaid
sequenceDiagram
  participant App
  participant Client as OfflineHttpClient
  participant DB as IndexedDB
  participant Events as SyncEventBus
  participant Net as Fetch API

  App->>Client: request(method, url, options)
  alt navigator offline or queueOnly
    Client->>DB: saveRequest(request)
    Client->>Events: queue:added(detail)
    Events-->>App: queue:added
  else online
    Client->>Net: fetch(url, init)
    Net-->>Client: Response / Error
    opt error
      Client->>DB: saveRequest(request)
      Client->>Events: sync:error(detail)
    end
  end
  par when online
    Client->>DB: list pending
    loop each request
      Client->>Net: fetch(url, init)
      alt success
        Net-->>Client: Response
        Client->>Events: sync:success(detail)
        Client->>DB: deleteRequest(id)
      else failure with retries left
        Net-->>Client: Error
        Client->>Events: sync:error(detail)
        Client->>Events: sync:retry(delay)
        Client->>DB: updateRequest(state=pending)
      else failure terminal
        Net-->>Client: Error/HTTP !ok
        Client->>Events: sync:failed(detail)
        Client->>DB: updateRequest(state=failed)
      end
    end
    Client->>Events: queue:drain(remaining)
  end
```

## Data persistence

- **Requests store**: `StoredRequest` records containing HTTP method, URL, serialised body, headers, metadata, retry policy, attempt counters, timestamps, and last error.
- **Events store**: chronological event log for auditability and UI reconstruction. Each event stores the payload dispatched through the runtime event bus.

## Error surface and recovery

- Immediate online errors surface to the request observable *and* `sync:error` events (with `willRetry = false`).
- Offline/queued errors surface through events only, ensuring UIs reopened later can rehydrate context.
- Failed requests remain in IndexedDB with `state = failed`. Applications can inspect them via `getFailedRequests()` and resubmit by calling `retryFailed([...ids])`.
