import type { RequestHandler } from 'express';
import type { AuthService } from '../modules/auth/auth.service.js';
export declare function authenticate(service: AuthService): RequestHandler;
