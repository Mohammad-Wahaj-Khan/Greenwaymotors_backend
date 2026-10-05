import type { RequestHandler } from 'express';
import { authenticationError } from '../core/errors/http-errors.js';
import type { AuthService } from '../modules/auth/auth.service.js';

export function authenticate(service: AuthService): RequestHandler {
  return async (request, _response, next) => {
    try {
      const authorization = request.get('authorization');
      if (!authorization?.startsWith('Bearer ')) {
        throw authenticationError();
      }
      const token = authorization.slice('Bearer '.length).trim();
      if (!token) {
        throw authenticationError();
      }
      request.auth = await service.authenticateAccessToken(token);
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}
