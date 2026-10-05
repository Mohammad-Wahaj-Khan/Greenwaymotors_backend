import { Router } from 'express';
import type { Environment } from '../../config/env.js';
import type { EmailService } from '../../integrations/email/email.service.js';
import type { RedisRateLimitStore } from '../../integrations/redis/redis.js';
import { authenticate } from '../../middleware/authenticate.middleware.js';
import { rateLimit } from '../../middleware/rate-limit.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { createAuthController } from './auth.controller.js';
import {
  emailSchema,
  loginSchema,
  registerCustomerSchema,
  resetPasswordSchema,
  tokenSchema,
  updateProfileSchema
} from './auth.schema.js';
import { AuthService } from './auth.service.js';

export function createAuthRouter(
  service: AuthService,
  email: EmailService,
  environment: Environment,
  redis?: RedisRateLimitStore
): Router {
  const router = Router();
  const controller = createAuthController(service, email, environment);
  const requiresAuth = authenticate(service);

  router.post(
    '/auth/customers/register',
    rateLimit({ keyPrefix: 'register', limit: 5, windowMs: 15 * 60 * 1000 }, redis),
    validateBody(registerCustomerSchema),
    controller.register
  );
  router.post(
    '/auth/login',
    rateLimit({ keyPrefix: 'login', limit: 5, windowMs: 15 * 60 * 1000 }, redis),
    validateBody(loginSchema),
    controller.login
  );
  router.post(
    '/auth/refresh',
    rateLimit({ keyPrefix: 'refresh', limit: 30, windowMs: 15 * 60 * 1000 }, redis),
    controller.refresh
  );
  router.post('/auth/logout', requiresAuth, controller.logout);
  router.post('/auth/logout-all', requiresAuth, controller.logoutAll);
  router.post(
    '/auth/email-verification/request',
    rateLimit({ keyPrefix: 'verify-email', limit: 3, windowMs: 60 * 60 * 1000 }, redis),
    validateBody(emailSchema),
    controller.requestVerification
  );
  router.post(
    '/auth/email-verification/confirm',
    validateBody(tokenSchema),
    controller.confirmVerification
  );
  router.post(
    '/auth/password/forgot',
    rateLimit({ keyPrefix: 'password-forgot', limit: 3, windowMs: 60 * 60 * 1000 }, redis),
    validateBody(emailSchema),
    controller.forgotPassword
  );
  router.post('/auth/password/reset', validateBody(resetPasswordSchema), controller.resetPassword);
  router.get('/auth/me', requiresAuth, controller.me);
  router.patch('/auth/me', requiresAuth, validateBody(updateProfileSchema), controller.updateMe);
  return router;
}
