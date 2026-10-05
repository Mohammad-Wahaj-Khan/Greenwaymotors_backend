import { forbiddenError } from '../core/errors/http-errors.js';
export function requirePermission(permission) {
    return (request, _response, next) => {
        if (!request.auth?.permissions.has(permission)) {
            next(forbiddenError());
            return;
        }
        next();
    };
}
//# sourceMappingURL=authorize.middleware.js.map