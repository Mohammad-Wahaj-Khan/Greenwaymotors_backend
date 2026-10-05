import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { validationError } from '../core/errors/http-errors.js';

export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (request, _response, next) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      next(validationError(result.error.issues.map((issue) => issue.message).join('; ')));
      return;
    }
    request.body = result.data;
    next();
  };
}
