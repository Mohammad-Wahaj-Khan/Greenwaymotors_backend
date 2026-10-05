export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly title: string;

  public constructor(status: number, code: string, title: string, detail?: string) {
    super(detail ?? title);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.title = title;
  }
}

export const notFoundError = new AppError(404, 'not_found', 'Not Found');
