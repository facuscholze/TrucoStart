import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'ACCOUNT_LOCKED',
  'CAPTCHA_FAILED',
  'RULE_VIOLATION',
  'ROOM_FULL',
  'INVALID_STATE',
  'BAD_GATEWAY',
  'INTERNAL_ERROR',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorDetailSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const ApiErrorResponseSchema = z.object({
  error: ApiErrorDetailSchema,
});

export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export function createApiErrorResponse(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };
}
