import type { ZodType, ZodTypeDef } from 'zod';
import { DomainApiException } from './api-exception.js';

export function parseWithZod<TOutput, TDef extends ZodTypeDef = ZodTypeDef, TInput = unknown>(
  schema: ZodType<TOutput, TDef, TInput>,
  input: unknown,
): TOutput {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new DomainApiException(400, 'VALIDATION_ERROR', 'Los datos enviados no son válidos', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
