import pino from 'pino';
import type { Environment } from '../../config/env.js';

export function createLogger(environment: Environment): pino.Logger {
  return pino({
    level: environment.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers.set-cookie',
        'password',
        '*.password',
        'token',
        '*.token'
      ],
      censor: '[REDACTED]'
    }
  });
}
