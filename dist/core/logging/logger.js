import pino from 'pino';
export function createLogger(environment) {
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
//# sourceMappingURL=logger.js.map