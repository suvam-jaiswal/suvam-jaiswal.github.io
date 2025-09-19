import type { HttpEventMap, HttpEventName } from '../types.js';

type Listener<K extends HttpEventName> = (event: HttpEventMap[K]) => void;

type AnyEvent = HttpEventMap[keyof HttpEventMap];

/**
 * A thin wrapper around EventTarget that provides strongly typed helper methods.
 */
export class HttpEventBus {
  private target: EventTarget;

  constructor(target?: EventTarget) {
    this.target = target ?? new EventTarget();
  }

  on<K extends HttpEventName>(type: K, listener: Listener<K>, options?: AddEventListenerOptions): () => void {
    const wrappedListener = listener as EventListener;
    this.target.addEventListener(type, wrappedListener, options);
    return () => this.target.removeEventListener(type, wrappedListener, options);
  }

  once<K extends HttpEventName>(type: K, listener: Listener<K>): () => void {
    return this.on(type, listener, { once: true });
  }

  off<K extends HttpEventName>(type: K, listener: Listener<K>, options?: EventListenerOptions): void {
    this.target.removeEventListener(type, listener as EventListener, options);
  }

  emit<K extends HttpEventName>(type: K, detail: HttpEventMap[K]['detail']): void {
    const event = new CustomEvent(type, { detail }) as AnyEvent;
    this.target.dispatchEvent(event);
  }
}
