import { AppError } from './app-error.js';
export function validationError(detail = 'The request is invalid.') {
    return new AppError(422, 'validation_error', 'Validation Error', detail);
}
export function authenticationError(detail = 'Authentication is required.') {
    return new AppError(401, 'unauthenticated', 'Unauthenticated', detail);
}
export function forbiddenError(detail = 'You do not have permission to perform this action.') {
    return new AppError(403, 'forbidden', 'Forbidden', detail);
}
export function conflictError(detail = 'The requested resource conflicts with existing data.') {
    return new AppError(409, 'conflict', 'Conflict', detail);
}
export function badRequestError(detail = 'The request cannot be processed.') {
    return new AppError(400, 'bad_request', 'Bad Request', detail);
}
//# sourceMappingURL=http-errors.js.map