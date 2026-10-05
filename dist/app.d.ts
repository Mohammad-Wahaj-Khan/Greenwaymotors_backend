import type { Express } from 'express';
import type { Environment } from './config/env.js';
import type { DatabaseConnection } from './core/db/database.js';
import { type HealthDependencies } from './modules/health/health-routes.js';
import type { EmailService } from './integrations/email/email.service.js';
import type { RedisConnection } from './integrations/redis/redis.js';
import { type ObjectStorage } from './integrations/storage/object-storage.js';
export interface AppDependencies extends HealthDependencies {
    database: DatabaseConnection;
    redis: RedisConnection;
    /** Kept for integration test fixtures; production delivery runs through the outbox worker. */
    email?: EmailService;
    storage?: ObjectStorage;
}
export declare function createApp(environment: Environment, dependencies: AppDependencies): Express;
