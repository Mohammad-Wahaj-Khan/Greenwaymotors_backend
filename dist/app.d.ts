import type { Express } from 'express';
import type { Environment } from './config/env.js';
import type { DatabaseConnection } from './core/db/database.js';
import { type HealthDependencies } from './modules/health/health-routes.js';
import type { EmailService } from './integrations/email/email.service.js';
import type { RedisConnection } from './integrations/redis/redis.js';
export interface AppDependencies extends HealthDependencies {
    database: DatabaseConnection;
    redis: RedisConnection;
    email?: EmailService;
}
export declare function createApp(environment: Environment, dependencies: AppDependencies): Express;
