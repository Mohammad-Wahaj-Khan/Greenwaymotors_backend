import type { ErrorRequestHandler } from 'express';
import { AppError } from '../core/errors/app-error.js';
import { getRequestContext } from '../core/http/request-context.js';

export const problemDetailsMiddleware: ErrorRequestHandler = (error, request, response, next) => {
  void next;
  const knownError = error instanceof AppError ? error : undefined;
  const status = knownError?.status ?? 500;
  const requestId = getRequestContext()?.requestId ?? response.getHeader('x-request-id');

  if (!knownError) {
    request.log.error({ err: error, requestId }, 'unhandled request error');
  }

  response
    .status(status)
    .type('application/problem+json')
    .json({
      type: `/problems/${knownError?.code ?? 'internal_error'}`,
      title: knownError?.title ?? 'Internal Server Error',
      status,
      detail: knownError?.message ?? 'An unexpected error occurred.',
      instance: request.originalUrl,
      code: knownError?.code ?? 'internal_error',
      requestId
    });
};
