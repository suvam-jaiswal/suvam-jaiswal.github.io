export class Subscription {
    constructor() {
        this.teardowns = [];
        this.closedInternal = false;
    }
    get closed() {
        return this.closedInternal;
    }
    add(teardown) {
        if (typeof teardown === 'function') {
            if (this.closedInternal) {
                teardown();
            }
            else {
                this.teardowns.push(teardown);
            }
        }
    }
    unsubscribe() {
        if (this.closedInternal) {
            return;
        }
        this.closedInternal = true;
        for (const teardown of this.teardowns) {
            try {
                teardown();
            }
            catch (error) {
                console.error('Error during subscription teardown', error);
            }
        }
        this.teardowns = [];
    }
}
export class HttpObservable {
    constructor(executor) {
        this.executor = executor;
    }
    subscribe(observerOrNext, error, complete) {
        const subscription = new Subscription();
        const observer = normalizeObserver(observerOrNext, error, complete);
        const safeObserver = {
            next: (value) => {
                if (!subscription.closed) {
                    observer.next?.(value);
                }
            },
            error: (err) => {
                if (!subscription.closed) {
                    try {
                        observer.error?.(err);
                    }
                    finally {
                        subscription.unsubscribe();
                    }
                }
            },
            complete: () => {
                if (!subscription.closed) {
                    try {
                        observer.complete?.();
                    }
                    finally {
                        subscription.unsubscribe();
                    }
                }
            },
        };
        try {
            const teardown = this.executor(safeObserver);
            subscription.add(teardown);
        }
        catch (err) {
            safeObserver.error?.(err);
        }
        return subscription;
    }
    pipe(...operators) {
        if (operators.length === 0) {
            return this;
        }
        return operators.reduce((prev, operator) => operator(prev), this);
    }
    map(project) {
        return new HttpObservable((observer) => {
            const subscription = this.subscribe({
                next: (value) => {
                    try {
                        observer.next?.(project(value));
                    }
                    catch (err) {
                        observer.error?.(err);
                    }
                },
                error: (err) => observer.error?.(err),
                complete: () => observer.complete?.(),
            });
            return () => subscription.unsubscribe();
        });
    }
    tap(sideEffect) {
        return new HttpObservable((observer) => {
            const subscription = this.subscribe({
                next: (value) => {
                    try {
                        sideEffect(value);
                        observer.next?.(value);
                    }
                    catch (err) {
                        observer.error?.(err);
                    }
                },
                error: (err) => observer.error?.(err),
                complete: () => observer.complete?.(),
            });
            return () => subscription.unsubscribe();
        });
    }
    catchError(recover) {
        return new HttpObservable((observer) => {
            let innerSubscription;
            const outerSubscription = this.subscribe({
                next: (value) => observer.next?.(value),
                complete: () => observer.complete?.(),
                error: (err) => {
                    try {
                        innerSubscription = recover(err).subscribe(observer);
                    }
                    catch (innerErr) {
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
    toPromise() {
        return new Promise((resolve, reject) => {
            let lastValue;
            let hasValue = false;
            this.subscribe({
                next: (value) => {
                    lastValue = value;
                    hasValue = true;
                },
                complete: () => {
                    if (hasValue) {
                        resolve(lastValue);
                    }
                    else {
                        reject(new Error('Observable completed without emitting a value'));
                    }
                },
                error: (err) => reject(err),
            });
        });
    }
}
function normalizeObserver(observerOrNext, error, complete) {
    if (!observerOrNext) {
        return {};
    }
    if (typeof observerOrNext === 'function') {
        const observer = { next: observerOrNext };
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
//# sourceMappingURL=httpObservable.js.map