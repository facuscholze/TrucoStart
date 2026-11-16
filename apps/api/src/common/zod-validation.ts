import type { z } from 'zod';
import { DomainApiException } from './api-exception.js';

export function parseWithZod<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new DomainApiException(400, 'VALIDATION_ERROR', 'Los datos enviados no son válidos', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
