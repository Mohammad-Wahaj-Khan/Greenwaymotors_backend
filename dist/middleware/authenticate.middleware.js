import { authenticationError, forbiddenError } from '../core/errors/http-errors.js';
export function authenticate(service) {
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
            if (request.auth.mfaRequired &&
                !request.auth.mfaSatisfied &&
                process.env.NODE_ENV === 'production' &&
                !(request.method === 'GET' && request.originalUrl.split('?')[0] === '/api/v1/auth/me') &&
                !(request.method === 'POST' &&
                    ['/api/v1/auth/me/mfa/enroll', '/api/v1/auth/me/mfa/confirm'].includes(request.originalUrl.split('?')[0] ?? ''))) {
                throw forbiddenError('Complete staff MFA enrollment before using this account.');
            }
            next();
        }
        catch (error) {
            next(error);
        }
    };
}
//# sourceMappingURL=authenticate.middleware.js.map