import { Router } from 'express';
import type { Environment } from '../../config/env.js';
import type { DatabaseHealth } from '../db/postgres.js';
import type { RedisHealth } from '../redis/redis.js';
export interface HealthDependencies {
    database: DatabaseHealth;
    redis: RedisHealth;
}
export declare function createHealthRouter(environment: Environment, dependencies: HealthDependencies): Router;
