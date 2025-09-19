export class HttpEventBus {
    constructor() {
        this.target = new EventTarget();
    }
    emit(type, detail) {
        const event = new CustomEvent(type, { detail });
        this.target.dispatchEvent(event);
    }
    on(type, listener, options) {
        const wrapped = listener;
        this.target.addEventListener(type, wrapped, options);
        return () => this.target.removeEventListener(type, wrapped, options);
    }
    once(type, listener) {
        return this.on(type, listener, { once: true });
    }
}
export const createEventBus = () => new HttpEventBus();
//# sourceMappingURL=events.js.map