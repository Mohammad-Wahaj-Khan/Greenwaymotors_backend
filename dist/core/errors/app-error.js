export class AppError extends Error {
    status;
    code;
    title;
    constructor(status, code, title, detail) {
        super(detail ?? title);
        this.name = 'AppError';
        this.status = status;
        this.code = code;
        this.title = title;
    }
}
export const notFoundError = new AppError(404, 'not_found', 'Not Found');
//# sourceMappingURL=app-error.js.map