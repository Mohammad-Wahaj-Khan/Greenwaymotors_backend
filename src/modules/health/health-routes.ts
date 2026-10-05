import { Router } from 'express';
import type { Environment } from '../../config/env.js';
import type { DatabaseHealth } from '../../core/db/database.js';
import type { RedisHealth } from '../../integrations/redis/redis.js';
import { getRequestContext } from '../../core/http/request-context.js';

export interface HealthDependencies {
  database: DatabaseHealth;
  redis: RedisHealth;
}

export function createHealthRouter(
  environment: Environment,
  dependencies: HealthDependencies
): Router {
  const router = Router();

  router.get('/live', (_request, response) => {
    response.status(200).json({
      data: { status: 'ok' },
      meta: { requestId: getRequestContext()?.requestId }
    });
  });

  router.get('/ready', async (_request, response) => {
    const checks: Promise<void>[] = [dependencies.database.ping()];
    if (environment.REDIS_REQUIRED) {
      checks.push(dependencies.redis.ping());
    }

    try {
      await Promise.all(checks);
      response.status(200).json({
        data: { status: 'ok' },
        meta: { requestId: getRequestContext()?.requestId }
      });
    } catch (error: unknown) {
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
