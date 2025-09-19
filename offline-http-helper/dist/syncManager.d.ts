import { HttpEventBus } from './events.js';
import { OfflineQueue } from './offlineQueue.js';
import type { ReplayErroredRequestOptions, ReplayResult, SyncManagerOptions } from './types.js';
export declare class HttpSyncManager {
    private readonly queue;
    private readonly events;
    private readonly options;
    private syncing;
    private disposed;
    private removeOnlineListener?;
    constructor(queue: OfflineQueue, events: HttpEventBus, options?: SyncManagerOptions);
    replayPending(): Promise<void>;
    retryErroredRequest(options: ReplayErroredRequestOptions): Promise<ReplayResult | undefined>;
    dispose(): void;
    private executeRequest;
}
//# sourceMappingURL=syncManager.d.ts.map