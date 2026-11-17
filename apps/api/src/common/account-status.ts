import type { MyModerationState } from '@truco/shared';
import type { UserRow } from '../db/schema/index.js';

export interface EffectiveAccountStatus {
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DELETED';
  /** `true` cuando la suspensión venció y la cuenta vuelve a estar habilitada. */
  readonly expiredSuspensionLifted: boolean;
  readonly reason: string | null;
  readonly expiresAt: Date | null;
  readonly mutedUntil: Date | null;
}

/**
 * Estado efectivo de una cuenta en el instante `now`.
 * Una suspensión temporal vencida se considera levantada (y el llamador la persiste),
 * pero un bloqueo (`BANNED`) sin vencimiento nunca se levanta solo.
 */
export function resolveEffectiveAccountStatus(user: UserRow, now: Date): EffectiveAccountStatus {
  const mutedUntil =
    user.mutedUntil && user.mutedUntil.getTime() > now.getTime() ? user.mutedUntil : null;

  if (user.deletedAt !== null || user.status === 'DELETED') {
    return {
      status: 'DELETED',
      expiredSuspensionLifted: false,
      reason: user.statusReason ?? null,
      expiresAt: user.statusExpiresAt ?? null,
      mutedUntil: null,
    };
  }

  if (user.status === 'SUSPENDED' && user.statusExpiresAt && user.statusExpiresAt <= now) {
    return {
      status: 'ACTIVE',
      expiredSuspensionLifted: true,
      reason: null,
      expiresAt: null,
      mutedUntil,
    };
  }

  return {
    status: user.status,
    expiredSuspensionLifted: false,
    reason: user.statusReason ?? null,
    expiresAt: user.statusExpiresAt ?? null,
    mutedUntil,
  };
}

export function isMuted(user: Pick<UserRow, 'mutedUntil'>, now: Date): boolean {
  return user.mutedUntil !== null && user.mutedUntil.getTime() > now.getTime();
}

/** Mensaje claro y en rioplatense para mostrar al jugador suspendido o bloqueado. */
export function describeBlockedAccount(status: EffectiveAccountStatus): string {
  if (status.status === 'BANNED') {
    return `Tu cuenta está bloqueada permanentemente. Motivo: ${status.reason ?? 'no informado'}.`;
  }
  if (status.status === 'SUSPENDED') {
    const until = status.expiresAt?.toISOString().slice(0, 10) ?? 'sin fecha';
    return `Tu cuenta está suspendida hasta el ${until}. Motivo: ${status.reason ?? 'no informado'}.`;
  }
  return 'Tu cuenta no está habilitada para jugar.';
}

export function toMyModerationState(
  user: UserRow,
  now: Date,
  openReportsAgainstMe: number,
): MyModerationState {
  const effective = resolveEffectiveAccountStatus(user, now);
  return {
    accountStatus: effective.status,
    statusReason: effective.reason,
    statusExpiresAt: effective.expiresAt?.toISOString() ?? null,
    mutedUntil: effective.mutedUntil?.toISOString() ?? null,
    openReportsAgainstMe,
  };
}
