export interface Observer<T> {
    next?(value: T): void;
    error?(err: unknown): void;
    complete?(): void;
}
export type TeardownLogic = (() => void) | void;
export declare class Subscription {
    private teardowns;
    private closedInternal;
    get closed(): boolean;
    add(teardown: TeardownLogic): void;
    unsubscribe(): void;
}
export type OperatorFunction<T, R> = (source: HttpObservable<T>) => HttpObservable<R>;
export declare class HttpObservable<T> {
    private readonly executor;
    constructor(executor: (observer: Observer<T>) => TeardownLogic);
    subscribe(): Subscription;
    subscribe(next: (value: T) => void): Subscription;
    subscribe(next: (value: T) => void, error: (err: unknown) => void): Subscription;
    subscribe(next: (value: T) => void, error: (err: unknown) => void, complete: () => void): Subscription;
    subscribe(observer: Observer<T>): Subscription;
    pipe(): HttpObservable<T>;
    pipe<A>(op1: OperatorFunction<T, A>): HttpObservable<A>;
    pipe<A, B>(op1: OperatorFunction<T, A>, op2: OperatorFunction<A, B>): HttpObservable<B>;
    pipe<A, B, C>(op1: OperatorFunction<T, A>, op2: OperatorFunction<A, B>, op3: OperatorFunction<B, C>): HttpObservable<C>;
    map<R>(project: (value: T) => R): HttpObservable<R>;
    tap(sideEffect: (value: T) => void): HttpObservable<T>;
    catchError(recover: (err: unknown) => HttpObservable<T>): HttpObservable<T>;
    toPromise(): Promise<T>;
}
//# sourceMappingURL=httpObservable.d.ts.map