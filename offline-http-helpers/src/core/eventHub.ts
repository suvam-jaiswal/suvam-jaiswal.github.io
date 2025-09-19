import type { HttpEventHubEventMap } from '../types.js';

type Listener<K extends keyof HttpEventHubEventMap> = (
  event: CustomEvent<HttpEventHubEventMap[K]>
) => void;

const createCustomEvent = <K extends keyof HttpEventHubEventMap>(
  type: K,
  detail: HttpEventHubEventMap[K]
): CustomEvent<HttpEventHubEventMap[K]> => {
  if (typeof CustomEvent === 'function') {
    return new CustomEvent(type, { detail });
  }

  // Fallback for environments that do not expose CustomEvent (e.g. older Node polyfills).
  if (typeof document !== 'undefined' && typeof document.createEvent === 'function') {
    const event = document.createEvent('CustomEvent');
    event.initCustomEvent(type as string, false, false, detail);
    return event as CustomEvent<HttpEventHubEventMap[K]>;
  }

  throw new Error('CustomEvent is not supported in this environment.');
};

export class HttpEventHub {
  private readonly target: EventTarget;

  constructor(target?: EventTarget) {
    this.target = target ?? new EventTarget();
  }

  emit<K extends keyof HttpEventHubEventMap>(type: K, detail: HttpEventHubEventMap[K]): void {
    const event = createCustomEvent(type, detail);
    this.target.dispatchEvent(event);
  }

  on<K extends keyof HttpEventHubEventMap>(type: K, listener: Listener<K>): () => void {
    const wrapped: EventListener = (event) => {
      listener(event as CustomEvent<HttpEventHubEventMap[K]>);
    };

    this.target.addEventListener(type, wrapped);

    return () => {
      this.target.removeEventListener(type, wrapped);
    };
  }

  once<K extends keyof HttpEventHubEventMap>(type: K, listener: Listener<K>): () => void {
    const wrapped: EventListener = (event) => {
      listener(event as CustomEvent<HttpEventHubEventMap[K]>);
    };

    this.target.addEventListener(type, wrapped, { once: true });

    return () => {
      this.target.removeEventListener(type, wrapped);
    };
  }

  off<K extends keyof HttpEventHubEventMap>(type: K, listener: Listener<K>): void {
    this.target.removeEventListener(type, listener as unknown as EventListener);
  }

  asEventTarget(): EventTarget {
    return this.target;
  }
}
