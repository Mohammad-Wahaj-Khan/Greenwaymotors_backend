import type { RequestHandler } from 'express';
import type { Environment } from '../../config/env.js';
import type { EmailService } from '../../integrations/email/email.service.js';
import type { AuthService } from './auth.service.js';
interface AuthController {
    register: RequestHandler;
    login: RequestHandler;
    refresh: RequestHandler;
    logout: RequestHandler;
    logoutAll: RequestHandler;
    requestVerification: RequestHandler;
    confirmVerification: RequestHandler;
    forgotPassword: RequestHandler;
    resetPassword: RequestHandler;
    me: RequestHandler;
    updateMe: RequestHandler;
}
export declare function createAuthController(service: AuthService, email: EmailService, environment: Environment): AuthController;
export {};
