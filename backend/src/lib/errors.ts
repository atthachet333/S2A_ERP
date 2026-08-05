/**
 * AppError — error ที่มี code/status สำหรับ map เป็น envelope
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const Errors = {
  validation: (details?: unknown) =>
    new AppError('VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง', 400, details),
  unauthorized: (message = 'กรุณาเข้าสู่ระบบ') => new AppError('UNAUTHORIZED', message, 401),
  forbidden: (message = 'ไม่มีสิทธิ์ดำเนินการ') => new AppError('FORBIDDEN', message, 403),
  notFound: (message = 'ไม่พบข้อมูล') => new AppError('NOT_FOUND', message, 404),
  conflict: (message = 'ข้อมูลซ้ำหรือถูกแก้ไขโดยผู้อื่น') => new AppError('CONFLICT', message, 409),
  insufficientStock: (details?: unknown) =>
    new AppError('INSUFFICIENT_STOCK', 'วัตถุดิบคงเหลือไม่เพียงพอ', 409, details),
  internal: (message = 'เกิดข้อผิดพลาดภายในระบบ') => new AppError('INTERNAL_ERROR', message, 500),
};
