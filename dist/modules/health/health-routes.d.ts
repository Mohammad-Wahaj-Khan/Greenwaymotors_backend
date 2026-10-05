import { Router } from 'express';
import type { Environment } from '../../config/env.js';
import type { DatabaseHealth } from '../../core/db/database.js';
import type { RedisHealth } from '../../integrations/redis/redis.js';
export interface HealthDependencies {
    database: DatabaseHealth;
    redis: RedisHealth;
}
export declare function createHealthRouter(environment: Environment, dependencies: HealthDependencies): Router;
