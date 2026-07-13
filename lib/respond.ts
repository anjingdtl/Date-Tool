import { NextResponse } from "next/server";
import { AppError, toErrorEnvelope } from "./errors";
import { logger } from "./logger";

export function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `req_${Date.now()}`;
}

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(err: unknown, requestId: string): NextResponse {
  const env = toErrorEnvelope(err, requestId);
  if (err instanceof AppError && err.isOperational) {
    logger.warn("request_error", {
      requestId,
      code: env.title,
      status: env.status,
    });
  } else {
    const e = err as Error;
    logger.error("unhandled_error", {
      requestId,
      message: e?.message,
      stack: e?.stack,
    });
  }
  return NextResponse.json(env, { status: env.status });
}
