export type NetworkListener = (online: boolean) => void;

export class NetworkStatus {
  private listeners = new Set<NetworkListener>();
  private pollingIntervalId: number | null = null;
  private lastState: boolean;

  constructor(private pollInterval = 15000) {
    this.lastState = this.isOnline();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  subscribe(listener: NetworkListener): () => void {
    this.listeners.add(listener);
    listener(this.lastState);
    this.ensurePolling();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stopPolling();
      }
    };
  }

  private ensurePolling() {
    if (typeof window === 'undefined') return;
    if (this.pollingIntervalId !== null) return;
    this.pollingIntervalId = window.setInterval(() => {
      const online = this.isOnline();
      if (online !== this.lastState) {
        this.lastState = online;
        this.notify(online);
      }
    }, this.pollInterval);
  }

  private stopPolling() {
    if (typeof window === 'undefined') return;
    if (this.pollingIntervalId !== null) {
      window.clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
    }
  }

  private handleOnline = () => {
    const online = true;
    this.lastState = online;
    this.notify(online);
  };

  private handleOffline = () => {
    const online = false;
    this.lastState = online;
    this.notify(online);
  };

  private notify(online: boolean) {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(online);
      } catch (error) {
        console.error('NetworkStatus listener failed', error);
      }
    }
  }

  isOnline(): boolean {
    if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') {
      return true; // assume online in non-browser environments
    }
    return navigator.onLine;
  }
}
