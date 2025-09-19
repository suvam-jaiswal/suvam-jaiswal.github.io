export type TeardownLogic = (() => void) | void;

export interface Observer<T> {
  next(value: T): void;
  error(err: unknown): void;
  complete(): void;
}

export type PartialObserver<T> = Partial<Observer<T>> | ((value: T) => void);

export class Subscription {
  private closed = false;
  constructor(private readonly teardown?: () => void) {}

  unsubscribe(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.teardown) {
      try {
        this.teardown();
      } catch (err) {
        console.error('Error during subscription teardown', err);
      }
    }
  }
}

export class Observable<T> {
  constructor(private readonly producer: (observer: Observer<T>) => TeardownLogic) {}

  subscribe(observer: PartialObserver<T>): Subscription {
    const sink: Observer<T> = normalizeObserver(observer);
    let teardown: TeardownLogic = undefined;
    let closed = false;

    try {
      teardown = this.producer({
        next: (value) => {
          if (!closed) {
            sink.next(value);
          }
        },
        error: (err) => {
          if (!closed) {
            closed = true;
            sink.error(err);
            if (teardown) {
              executeTeardown(teardown);
            }
          }
        },
        complete: () => {
          if (!closed) {
            closed = true;
            sink.complete();
            if (teardown) {
              executeTeardown(teardown);
            }
          }
        },
      });
    } catch (err) {
      closed = true;
      sink.error(err);
    }

    return new Subscription(() => {
      if (!closed) {
        closed = true;
        if (teardown) {
          executeTeardown(teardown);
        }
      }
    });
  }

  static of<T>(value: T): Observable<T> {
    return new Observable<T>((observer) => {
      observer.next(value);
      observer.complete();
    });
  }
}

function normalizeObserver<T>(observer: PartialObserver<T>): Observer<T> {
  if (typeof observer === 'function') {
    return {
      next: observer,
      error: (err: unknown) => console.error('Unhandled observable error', err),
      complete: () => undefined,
    };
  }

  return {
    next: observer.next?.bind(observer) ?? (() => undefined),
    error:
      observer.error?.bind(observer) ?? ((err: unknown) => console.error('Unhandled observable error', err)),
    complete: observer.complete?.bind(observer) ?? (() => undefined),
  };
}

function executeTeardown(teardown: TeardownLogic): void {
  if (typeof teardown === 'function') {
    teardown();
  }
}
