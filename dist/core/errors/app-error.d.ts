export declare class AppError extends Error {
    readonly status: number;
    readonly code: string;
    readonly title: string;
    constructor(status: number, code: string, title: string, detail?: string);
}
export declare const notFoundError: AppError;
