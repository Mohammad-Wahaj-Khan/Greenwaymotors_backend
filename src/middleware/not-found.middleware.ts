import type { RequestHandler } from 'express';
import { notFoundError } from '../core/errors/app-error.js';

export const notFoundMiddleware: RequestHandler = (_request, _response, next) => {
  next(notFoundError);
};
