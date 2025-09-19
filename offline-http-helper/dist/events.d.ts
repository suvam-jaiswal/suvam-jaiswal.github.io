import type { RequestErrorEventDetail, RequestQueuedEventDetail, ReplayResult, SyncCompleteEventDetail, SyncLifecycleEventDetail, SyncProgressEventDetail } from './types.js';
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
export declare class HttpEventBus {
    private readonly target;
    emit<K extends EventType>(type: K, detail: HttpEventMap[K]['detail']): void;
    on<K extends EventType>(type: K, listener: (event: HttpEventMap[K]) => void, options?: boolean | AddEventListenerOptions): () => void;
    once<K extends EventType>(type: K, listener: (event: HttpEventMap[K]) => void): () => void;
}
export declare const createEventBus: () => HttpEventBus;
//# sourceMappingURL=events.d.ts.map