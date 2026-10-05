import { AsyncLocalStorage } from 'node:async_hooks';
const storage = new AsyncLocalStorage();
export function runWithRequestContext(context, callback) {
    return storage.run(context, callback);
}
export function getRequestContext() {
    return storage.getStore();
}
//# sourceMappingURL=request-context.js.map