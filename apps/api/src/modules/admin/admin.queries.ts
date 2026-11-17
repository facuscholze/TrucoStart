import { z } from 'zod';
import { parseWithZod } from '../../common/zod-validation.js';

const PaginationSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(64).optional(),
  })
  .passthrough();

/** Validación de query strings del panel (limitado y explícito por endpoint). */
export const AdminQueries = {
  users: {
    parse(input: unknown) {
      const parsed = parseWithZod(
        PaginationSchema.extend({
          query: z.string().trim().max(120).optional(),
        }),
        input ?? {},
      );
      return {
        query: parsed.query && parsed.query.length > 0 ? parsed.query : null,
        cursor: parsed.cursor ?? null,
        limit: parsed.limit,
      };
    },
  },
  reason: {
    parse(input: unknown) {
      const parsed = parseWithZod(
        z
          .object({
            reason: z.string().trim().min(10).max(500),
          })
          .passthrough(),
        input ?? {},
      );
      return { reason: parsed.reason };
    },
  },
  reasonWithBody: {
    parse(input: unknown) {
      const parsed = parseWithZod(
        z.object({ reason: z.string().trim().min(10).max(500) }).strict(),
        input ?? {},
      );
      return { reason: parsed.reason };
    },
  },
  reports: {
    parse(input: unknown) {
      const parsed = parseWithZod(
        PaginationSchema.extend({
          status: z
            .enum(['OPEN', 'IN_REVIEW', 'RESOLVED_ACTIONED', 'RESOLVED_DISMISSED'])
            .optional(),
          reasonCode: z
            .enum(['ABANDONMENT', 'COLLUSION', 'OFFENSIVE_NICKNAME', 'ABUSIVE_BEHAVIOR', 'OTHER'])
            .optional(),
        }),
        input ?? {},
      );
      return {
        status: parsed.status ?? null,
        reasonCode: parsed.reasonCode ?? null,
        cursor: parsed.cursor ?? null,
        limit: parsed.limit,
      };
    },
  },
  audit: {
    parse(input: unknown) {
      const parsed = parseWithZod(
        PaginationSchema.extend({
          action: z.string().trim().max(80).optional(),
          entityId: z.string().trim().max(128).optional(),
        }),
        input ?? {},
      );
      return {
        action: parsed.action ?? null,
        entityId: parsed.entityId ?? null,
        cursor: parsed.cursor ?? null,
        limit: parsed.limit,
      };
    },
  },
};
