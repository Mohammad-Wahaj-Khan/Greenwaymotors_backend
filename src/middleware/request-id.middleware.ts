import type { RequestHandler } from 'express';
import { runWithRequestContext } from '../core/http/request-context.js';
import { resolveRequestId } from '../core/http/request-id.js';

export const requestIdMiddleware: RequestHandler = (request, response, next) => {
  const requestId = resolveRequestId(request.header('x-request-id'));
  response.setHeader('x-request-id', requestId);

  const context = request.ip ? { requestId, ip: request.ip } : { requestId };
  runWithRequestContext(context, next);
};
