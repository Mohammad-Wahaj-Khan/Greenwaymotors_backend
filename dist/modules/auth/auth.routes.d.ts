import { Router } from 'express';
import type { Environment } from '../../config/env.js';
import type { EmailService } from '../../integrations/email/email.service.js';
import type { RedisRateLimitStore } from '../../integrations/redis/redis.js';
import { AuthService } from './auth.service.js';
export declare function createAuthRouter(service: AuthService, email: EmailService, environment: Environment, redis?: RedisRateLimitStore): Router;
