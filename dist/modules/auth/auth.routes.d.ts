import { Router } from 'express';
import type { Environment } from '../../config/env.js';
import type { RedisRateLimitStore } from '../../integrations/redis/redis.js';
import { AuthService } from './auth.service.js';
export declare function createAuthRouter(service: AuthService, environment: Environment, redis?: RedisRateLimitStore): Router;
