import type { RequestHandler } from 'express';
import { forbiddenError } from '../core/errors/http-errors.js';

export function requirePermission(permission: string): RequestHandler {
  return (request, _response, next) => {
    if (!request.auth?.permissions.has(permission)) {
      next(forbiddenError());
      return;
    }
    next();
  };
}
