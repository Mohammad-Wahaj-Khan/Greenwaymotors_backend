import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.middleware.js';
import { rateLimit } from '../../middleware/rate-limit.middleware.js';
import { validateBody } from '../../middleware/validate.middleware.js';
import { createAuthController } from './auth.controller.js';
import { emailSchema, changePasswordSchema, loginSchema, mfaChallengeSchema, mfaCodeSchema, registerCustomerSchema, resetPasswordSchema, tokenSchema, updateProfileSchema } from './auth.schema.js';
import { AuthService } from './auth.service.js';
export function createAuthRouter(service, environment, redis) {
    const router = Router();
    const controller = createAuthController(service, environment);
    const requiresAuth = authenticate(service);
    router.post('/auth/customers/register', rateLimit({ keyPrefix: 'register', limit: 5, windowMs: 15 * 60 * 1000 }, redis), validateBody(registerCustomerSchema), controller.register);
    router.post('/auth/login', rateLimit({ keyPrefix: 'login', limit: 5, windowMs: 15 * 60 * 1000 }, redis), validateBody(loginSchema), controller.login);
    router.post('/auth/mfa/challenge', rateLimit({ keyPrefix: 'mfa-challenge', limit: 6, windowMs: 15 * 60 * 1000 }, redis), validateBody(mfaChallengeSchema), controller.mfaChallenge);
    router.post('/auth/refresh', rateLimit({ keyPrefix: 'refresh', limit: 30, windowMs: 15 * 60 * 1000 }, redis), controller.refresh);
    router.post('/auth/logout', requiresAuth, controller.logout);
    router.post('/auth/logout-all', requiresAuth, controller.logoutAll);
    router.post('/auth/email-verification/request', rateLimit({ keyPrefix: 'verify-email', limit: 3, windowMs: 60 * 60 * 1000 }, redis), validateBody(emailSchema), controller.requestVerification);
    router.post('/auth/email-verification/confirm', validateBody(tokenSchema), controller.confirmVerification);
    router.post('/auth/password/forgot', rateLimit({ keyPrefix: 'password-forgot', limit: 3, windowMs: 60 * 60 * 1000 }, redis), validateBody(emailSchema), controller.forgotPassword);
    router.post('/auth/password/reset', validateBody(resetPasswordSchema), controller.resetPassword);
    router.post('/auth/me/change-password', requiresAuth, validateBody(changePasswordSchema), controller.changePassword);
    router.get('/auth/me', requiresAuth, controller.me);
    router.post('/auth/me/mfa/enroll', requiresAuth, rateLimit({ keyPrefix: 'mfa-enroll', limit: 3, windowMs: 60 * 60 * 1000 }, redis), controller.mfaEnroll);
    router.post('/auth/me/mfa/confirm', requiresAuth, rateLimit({ keyPrefix: 'mfa-confirm', limit: 6, windowMs: 15 * 60 * 1000 }, redis), validateBody(mfaCodeSchema), controller.mfaConfirm);
    router.patch('/auth/me', requiresAuth, validateBody(updateProfileSchema), controller.updateMe);
    return router;
}
//# sourceMappingURL=auth.routes.js.map