import { AppError } from './app-error.js';
export declare function validationError(detail?: string): AppError;
export declare function authenticationError(detail?: string): AppError;
export declare function forbiddenError(detail?: string): AppError;
export declare function conflictError(detail?: string): AppError;
export declare function badRequestError(detail?: string): AppError;
