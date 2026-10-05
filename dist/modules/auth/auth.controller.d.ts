import type { RequestHandler } from 'express';
import type { Environment } from '../../config/env.js';
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
    changePassword: RequestHandler;
    me: RequestHandler;
    updateMe: RequestHandler;
    mfaChallenge: RequestHandler;
    mfaEnroll: RequestHandler;
    mfaConfirm: RequestHandler;
}
export declare function createAuthController(service: AuthService, environment: Environment): AuthController;
export {};
