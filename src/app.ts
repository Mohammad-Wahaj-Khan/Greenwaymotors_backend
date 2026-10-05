import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Express } from 'express';
import type { Environment } from './config/env.js';
import type { DatabaseConnection } from './core/db/database.js';
import { createHealthRouter, type HealthDependencies } from './modules/health/health-routes.js';
import { createPublicRouter } from './modules/public/public-routes.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { createRbacRouter } from './modules/rbac/rbac.routes.js';
import { createLogger } from './core/logging/logger.js';
import { createEmailService } from './integrations/email/email.service.js';
import type { EmailService } from './integrations/email/email.service.js';
import type { RedisConnection } from './integrations/redis/redis.js';
import { getRequestContext } from './core/http/request-context.js';
import { problemDetailsMiddleware } from './middleware/error.middleware.js';
import { notFoundMiddleware } from './middleware/not-found.middleware.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { authenticate } from './middleware/authenticate.middleware.js';
import { requirePermission } from './middleware/authorize.middleware.js';
import { createSourceMarketRouter } from './modules/admin/source-market.routes.js';
import { createVehicleRouter } from './modules/admin/vehicle.routes.js';
import { createUploadMediaRouter } from './modules/admin/upload-media.routes.js';
import { createObjectStorage, type ObjectStorage } from './integrations/storage/object-storage.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';
import { createPublicLeadsRouter } from './modules/leads/public-leads.routes.js';
import { createStaffLeadsRouter } from './modules/leads/staff-leads.routes.js';
import { createQuoteRouter } from './modules/commercial/quote.routes.js';
import { createDealRouter } from './modules/commercial/deal.routes.js';

export interface AppDependencies extends HealthDependencies {
  database: DatabaseConnection;
  redis: RedisConnection;
  email?: EmailService;
  storage?: ObjectStorage;
}

export function createApp(environment: Environment, dependencies: AppDependencies): Express {
  const app = express();
  const logger = createLogger(environment);
  const authService = new AuthService(dependencies.database.db, environment);

  app.set('trust proxy', environment.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(pinoHttp({ logger, customProps: () => ({ requestId: getRequestContext()?.requestId }) }));
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || origin === environment.WEB_ORIGIN) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(compression());
  app.use('/health', createHealthRouter(environment, dependencies));
  if (environment.NODE_ENV !== 'production') {
    const specification = readFileSync(
      fileURLToPath(new URL('../openapi/openapi.yaml', import.meta.url)),
      'utf8'
    );
    const document = YAML.parse(specification) as Record<string, unknown>;
    app.get('/api/docs/openapi.yaml', (_request, response) =>
      response.type('text/yaml').send(specification)
    );
    app.use(
      '/api/docs',
      swaggerUi.serve,
      swaggerUi.setup(document, { swaggerOptions: { persistAuthorization: true } })
    );
  }
  app.use(
    '/api/v1',
    createAuthRouter(
      authService,
      dependencies.email ?? createEmailService(environment),
      environment,
      environment.REDIS_REQUIRED ? dependencies.redis : undefined
    )
  );
  app.use(
    '/api/v1/admin',
    authenticate(authService),
    createSourceMarketRouter(dependencies.database.db),
    createVehicleRouter(dependencies.database.db),
    createUploadMediaRouter(
      dependencies.database.db,
      dependencies.storage ?? createObjectStorage(environment)
    ),
    requirePermission('rbac.manage'),
    createRbacRouter(dependencies.database)
  );
  app.use(
    '/api/v1/staff',
    authenticate(authService),
    createStaffLeadsRouter(dependencies.database.db),
    createQuoteRouter(dependencies.database.db),
    createDealRouter(dependencies.database.db)
  );
  app.use(
    '/api/v1',
    createPublicLeadsRouter(
      dependencies.database.db,
      authService,
      environment.REDIS_REQUIRED ? dependencies.redis : undefined
    )
  );
  app.use('/api/v1', createPublicRouter(dependencies.database));
  app.use(notFoundMiddleware);
  app.use(problemDetailsMiddleware);

  return app;
}
