import { Router } from 'express';
import { getRequestContext } from '../../core/http/request-context.js';
export function createHealthRouter(environment, dependencies) {
    const router = Router();
    router.get('/live', (_request, response) => {
        response.status(200).json({
            data: { status: 'ok' },
            meta: { requestId: getRequestContext()?.requestId }
        });
    });
    router.get('/ready', async (_request, response) => {
        const checks = [dependencies.database.ping()];
        if (environment.REDIS_REQUIRED) {
            checks.push(dependencies.redis.ping());
        }
        try {
            await Promise.all(checks);
            response.status(200).json({
                data: { status: 'ok' },
                meta: { requestId: getRequestContext()?.requestId }
            });
        }
        catch (error) {
            response.status(503).type('application/problem+json').json({
                type: '/problems/dependency_unavailable',
                title: 'Service Unavailable',
                status: 503,
                detail: 'A required dependency is unavailable.',
                code: 'dependency_unavailable',
                requestId: getRequestContext()?.requestId
            });
            _request.log.warn({ err: error }, 'readiness check failed');
        }
    });
    return router;
}
//# sourceMappingURL=health-routes.js.map