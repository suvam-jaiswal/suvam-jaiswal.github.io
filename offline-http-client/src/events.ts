import type { SyncEventMap, SyncEventRecord, SyncEventType } from './types.js';

export type SyncEventListener<T extends SyncEventType> = (event: CustomEvent<SyncEventMap[T]>) => void;

export class SyncEventBus {
  private readonly target = new EventTarget();

  on<T extends SyncEventType>(type: T, listener: SyncEventListener<T>, options?: AddEventListenerOptions): void {
    this.target.addEventListener(type, listener as EventListener, options);
  }

  off<T extends SyncEventType>(type: T, listener: SyncEventListener<T>, options?: EventListenerOptions): void {
    this.target.removeEventListener(type, listener as EventListener, options);
  }

  once<T extends SyncEventType>(type: T, listener: SyncEventListener<T>): void {
    const wrapper: SyncEventListener<T> = ((event: CustomEvent<SyncEventMap[T]>) => {
      this.off(type, wrapper);
      listener(event);
    }) as SyncEventListener<T>;
    this.on(type, wrapper);
  }

  emit<T extends SyncEventType>(type: T, detail: SyncEventMap[T]): SyncEventRecord<T> {
    const record: SyncEventRecord<T> = {
      id: generateId(),
      type,
      detail,
      timestamp: Date.now(),
    };
    const event = new CustomEvent(type, { detail });
    this.target.dispatchEvent(event);
    return record;
  }
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
