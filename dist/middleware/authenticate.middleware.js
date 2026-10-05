import { authenticationError } from '../core/errors/http-errors.js';
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
            next();
        }
        catch (error) {
            next(error);
        }
    };
}
//# sourceMappingURL=authenticate.middleware.js.map