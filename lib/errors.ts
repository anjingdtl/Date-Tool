export class AppError extends Error {
  code: string;
  statusCode: number;
  isOperational: boolean;
  details?: unknown;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    details?: unknown,
    isOperational = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "请求参数错误", details?: unknown) {
    super(message, "BAD_REQUEST", 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "资源不存在") {
    super(message, "NOT_FOUND", 404);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message = "无法处理该文件", details?: unknown) {
    super(message, "UNPROCESSABLE_ENTITY", 422, details);
  }
}

export class InternalError extends AppError {
  constructor(message = "服务器内部错误", details?: unknown) {
    super(message, "INTERNAL_ERROR", 500, details, false);
  }
}

export interface ErrorEnvelope {
  title: string;
  status: number;
  detail: string;
  request_id: string;
  details?: unknown;
}

export function toErrorEnvelope(
  err: unknown,
  requestId: string,
): ErrorEnvelope {
  if (err instanceof AppError) {
    return {
      title: err.code,
      status: err.statusCode,
      detail: err.message,
      request_id: requestId,
      ...(err.details !== undefined ? { details: err.details } : {}),
    };
  }
  return {
    title: "INTERNAL_ERROR",
    status: 500,
    detail: err instanceof Error ? err.message : "未知错误",
    request_id: requestId,
  };
}
