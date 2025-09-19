export interface Observer<T> {
  next?(value: T): void;
  error?(err: unknown): void;
  complete?(): void;
}

export type TeardownLogic = (() => void) | void;

export class Subscription {
  private teardowns: Array<() => void> = [];
  private closedInternal = false;

  get closed(): boolean {
    return this.closedInternal;
  }

  add(teardown: TeardownLogic): void {
    if (typeof teardown === 'function') {
      if (this.closedInternal) {
        teardown();
      } else {
        this.teardowns.push(teardown);
      }
    }
  }

  unsubscribe(): void {
    if (this.closedInternal) {
      return;
    }
    this.closedInternal = true;
    for (const teardown of this.teardowns) {
      try {
        teardown();
      } catch (error) {
        console.error('Error during subscription teardown', error);
      }
    }
    this.teardowns = [];
  }
}

export type OperatorFunction<T, R> = (source: HttpObservable<T>) => HttpObservable<R>;

export class HttpObservable<T> {
  constructor(private readonly executor: (observer: Observer<T>) => TeardownLogic) {}

  subscribe(): Subscription;
  subscribe(next: (value: T) => void): Subscription;
  subscribe(next: (value: T) => void, error: (err: unknown) => void): Subscription;
  subscribe(
    next: (value: T) => void,
    error: (err: unknown) => void,
    complete: () => void,
  ): Subscription;
  subscribe(observer: Observer<T>): Subscription;
  subscribe(
    observerOrNext?: Observer<T> | ((value: T) => void),
    error?: (err: unknown) => void,
    complete?: () => void,
  ): Subscription {
    const subscription = new Subscription();
    const observer = normalizeObserver(observerOrNext, error, complete);

    const safeObserver: Observer<T> = {
      next: (value) => {
        if (!subscription.closed) {
          observer.next?.(value);
        }
      },
      error: (err) => {
        if (!subscription.closed) {
          try {
            observer.error?.(err);
          } finally {
            subscription.unsubscribe();
          }
        }
      },
      complete: () => {
        if (!subscription.closed) {
          try {
            observer.complete?.();
          } finally {
            subscription.unsubscribe();
          }
        }
      },
    };

    try {
      const teardown = this.executor(safeObserver);
      subscription.add(teardown);
    } catch (err) {
      safeObserver.error?.(err);
    }

    return subscription;
  }

  pipe(): HttpObservable<T>;
  pipe<A>(op1: OperatorFunction<T, A>): HttpObservable<A>;
  pipe<A, B>(op1: OperatorFunction<T, A>, op2: OperatorFunction<A, B>): HttpObservable<B>;
  pipe<A, B, C>(
    op1: OperatorFunction<T, A>,
    op2: OperatorFunction<A, B>,
    op3: OperatorFunction<B, C>,
  ): HttpObservable<C>;
  pipe<R>(...operators: OperatorFunction<any, any>[]): HttpObservable<R> {
    if (operators.length === 0) {
      return this as unknown as HttpObservable<R>;
    }
    return operators.reduce((prev, operator) => operator(prev), this as any);
  }

  map<R>(project: (value: T) => R): HttpObservable<R> {
    return new HttpObservable<R>((observer) => {
      const subscription = this.subscribe({
        next: (value) => {
          try {
            observer.next?.(project(value));
          } catch (err) {
            observer.error?.(err);
          }
        },
        error: (err) => observer.error?.(err),
        complete: () => observer.complete?.(),
      });
      return () => subscription.unsubscribe();
    });
  }

  tap(sideEffect: (value: T) => void): HttpObservable<T> {
    return new HttpObservable<T>((observer) => {
      const subscription = this.subscribe({
        next: (value) => {
          try {
            sideEffect(value);
            observer.next?.(value);
          } catch (err) {
            observer.error?.(err);
          }
        },
        error: (err) => observer.error?.(err),
        complete: () => observer.complete?.(),
      });
      return () => subscription.unsubscribe();
    });
  }

  catchError(recover: (err: unknown) => HttpObservable<T>): HttpObservable<T> {
    return new HttpObservable<T>((observer) => {
      let innerSubscription: Subscription | undefined;
      const outerSubscription = this.subscribe({
        next: (value) => observer.next?.(value),
        complete: () => observer.complete?.(),
        error: (err) => {
          try {
            innerSubscription = recover(err).subscribe(observer);
          } catch (innerErr) {
            observer.error?.(innerErr);
          }
        },
      });
      return () => {
        outerSubscription.unsubscribe();
        innerSubscription?.unsubscribe();
      };
    });
  }

  toPromise(): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let lastValue: T;
      let hasValue = false;
      this.subscribe({
        next: (value) => {
          lastValue = value;
          hasValue = true;
        },
        complete: () => {
          if (hasValue) {
            resolve(lastValue);
          } else {
            reject(new Error('Observable completed without emitting a value'));
          }
        },
        error: (err) => reject(err),
      });
    });
  }
}

function normalizeObserver<T>(
  observerOrNext?: Observer<T> | ((value: T) => void),
  error?: (err: unknown) => void,
  complete?: () => void,
): Observer<T> {
  if (!observerOrNext) {
    return {};
  }
  if (typeof observerOrNext === 'function') {
    const observer: Observer<T> = { next: observerOrNext };
    if (error) {
      observer.error = error;
    }
    if (complete) {
      observer.complete = complete;
    }
    return observer;
  }
  return observerOrNext;
}

