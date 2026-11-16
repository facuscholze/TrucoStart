import { Inject, Injectable } from '@nestjs/common';
import { generateUuidV7 } from '../../common/uuidv7.js';
import { type AppDatabase, DRIZZLE_DB } from '../../db/database.provider.js';
import { auditLogsTable } from '../../db/schema/index.js';

export interface RecordAuditLogInput {
  readonly actorId?: string | null;
  readonly action: string;
  readonly entity: string;
  readonly entityId?: string | null;
  readonly beforeState?: Record<string, unknown> | null;
  readonly afterState?: Record<string, unknown> | null;
  readonly ip?: string | null;
  readonly now?: Date;
}

@Injectable()
export class AuditRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: AppDatabase) {}

  async record(input: RecordAuditLogInput): Promise<void> {
    const now = input.now ?? new Date();
    await this.db.insert(auditLogsTable).values({
      id: generateUuidV7(now.getTime()),
      actorId: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      beforeState: input.beforeState ?? null,
      afterState: input.afterState ?? null,
      ip: input.ip ?? null,
      createdAt: now,
    });
  }
}
