import { notFoundError } from '../core/errors/app-error.js';
export const notFoundMiddleware = (_request, _response, next) => {
    next(notFoundError);
};
//# sourceMappingURL=not-found.middleware.js.map