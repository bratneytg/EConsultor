export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'bad_request') => new AppError(400, code, message);
export const unauthorized = (message = 'No autenticado', code = 'unauthorized') => new AppError(401, code, message);
export const forbidden = (message = 'Acción no permitida', code = 'forbidden') => new AppError(403, code, message);
export const notFound = (message = 'No encontrado') => new AppError(404, 'not_found', message);
export const conflict = (message: string, code = 'conflict') => new AppError(409, code, message);
