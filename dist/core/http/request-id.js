import { randomUUID } from 'node:crypto';
const requestIdPattern = /^[A-Za-z0-9_-]{8,128}$/;
export function resolveRequestId(value) {
    return value && requestIdPattern.test(value) ? value : randomUUID();
}
//# sourceMappingURL=request-id.js.map