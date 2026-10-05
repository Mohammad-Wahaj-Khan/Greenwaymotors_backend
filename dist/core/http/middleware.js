import { randomUUID } from 'node:crypto';
import { AppError, notFoundError } from '../errors/app-error.js';
import { getRequestContext, runWithRequestContext } from '../context/request-context.js';
export const requestContextMiddleware = (request, response, next) => {
    const suppliedId = request.header('x-request-id');
    const requestId = suppliedId && /^[A-Za-z0-9_-]{8,128}$/.test(suppliedId) ? suppliedId : randomUUID();
    response.setHeader('x-request-id', requestId);
    const context = request.ip ? { requestId, ip: request.ip } : { requestId };
    runWithRequestContext(context, next);
};
export const notFoundMiddleware = (_request, _response, next) => {
    next(notFoundError);
};
export const problemDetailsMiddleware = (error, request, response, next) => {
    void next;
    const knownError = error instanceof AppError ? error : undefined;
    const status = knownError?.status ?? 500;
    const requestId = getRequestContext()?.requestId ?? response.getHeader('x-request-id');
    if (!knownError) {
        request.log.error({ err: error, requestId }, 'unhandled request error');
    }
    response
        .status(status)
        .type('application/problem+json')
        .json({
        type: `https://api.greenway.local/problems/${knownError?.code ?? 'internal_error'}`,
        title: knownError?.title ?? 'Internal Server Error',
        status,
        detail: knownError?.message ?? 'An unexpected error occurred.',
        instance: request.originalUrl,
        code: knownError?.code ?? 'internal_error',
        requestId
    });
};
//# sourceMappingURL=middleware.js.map