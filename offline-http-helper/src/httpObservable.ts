export type Observer<T> = {
  next?: (value: T) => void;
  error?: (error: unknown) => void;
  complete?: () => void;
};

export interface Subscription {
  unsubscribe(): void;
}

export class HttpObservable<T> {
  private _subscribeFn: (observer: Observer<T>) => () => void | void;

  constructor(subscribeFn: (observer: Observer<T>) => () => void | void) {
    this._subscribeFn = subscribeFn;
  }

  subscribe(observer: Observer<T>): Subscription {
    let teardown: (() => void) | void;
    const safeObserver: Observer<T> = {
      next: (value) => observer.next?.(value),
      error: (error) => observer.error?.(error),
      complete: () => observer.complete?.(),
    };

    teardown = this._subscribeFn(safeObserver);

    return {
      unsubscribe() {
        if (typeof teardown === 'function') {
          teardown();
        }
      },
    };
  }

  static fromPromise<T>(promiseFactory: () => Promise<T>): HttpObservable<T> {
    return new HttpObservable<T>((observer) => {
      let cancelled = false;
      promiseFactory()
        .then((value) => {
          if (cancelled) return;
          observer.next?.(value);
          observer.complete?.();
        })
        .catch((error) => {
          if (cancelled) return;
          observer.error?.(error);
        });

      return () => {
        cancelled = true;
      };
    });
  }
}
