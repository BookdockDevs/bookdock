import type { Context } from 'hono'
import type { StatusCode } from 'hono/utils/http-status'
import { ErrorHttpStatus } from '@bookdock/shared'

export class AppError extends Error {
  constructor(
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code)
    this.name = 'AppError'
  }
}

export function errorHandler(err: Error, c: Context) {
  if (err instanceof AppError) {
    const status = (ErrorHttpStatus[err.code as keyof typeof ErrorHttpStatus] ?? 500) as StatusCode
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, status as any)
  }
  console.error('Unhandled error:', err)
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500)
}
