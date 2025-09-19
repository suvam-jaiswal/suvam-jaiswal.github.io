import type {
  RequestErrorEventDetail,
  RequestQueuedEventDetail,
  ReplayResult,
  SyncCompleteEventDetail,
  SyncLifecycleEventDetail,
  SyncProgressEventDetail,
} from './types.js';

export type HttpEventMap = {
  requestqueued: CustomEvent<RequestQueuedEventDetail>;
  requesterror: CustomEvent<RequestErrorEventDetail>;
  syncstart: CustomEvent<SyncLifecycleEventDetail>;
  syncprogress: CustomEvent<SyncProgressEventDetail>;
  syncerror: CustomEvent<SyncProgressEventDetail>;
  syncsuccess: CustomEvent<SyncProgressEventDetail>;
  synccomplete: CustomEvent<SyncCompleteEventDetail>;
  replayresult: CustomEvent<ReplayResult>;
};

export type EventType = keyof HttpEventMap;

export class HttpEventBus {
  private readonly target = new EventTarget();

  emit<K extends EventType>(type: K, detail: HttpEventMap[K]['detail']): void {
    const event = new CustomEvent(type, { detail }) as HttpEventMap[K];
    this.target.dispatchEvent(event);
  }

  on<K extends EventType>(
    type: K,
    listener: (event: HttpEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): () => void {
    const wrapped = listener as EventListener;
    this.target.addEventListener(type, wrapped, options);
    return () => this.target.removeEventListener(type, wrapped, options);
  }

  once<K extends EventType>(type: K, listener: (event: HttpEventMap[K]) => void): () => void {
    return this.on(type, listener, { once: true });
  }
}

export const createEventBus = (): HttpEventBus => new HttpEventBus();

