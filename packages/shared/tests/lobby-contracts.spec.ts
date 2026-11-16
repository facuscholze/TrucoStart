import { describe, expect, it } from 'vitest';
import {
  CreateTableRequestSchema,
  generateJoinCodeFromRandomBytes,
  JOIN_CODE_ALPHABET,
  JoinByCodeRequestSchema,
  ListTablesQuerySchema,
  MatchLifecycleEventSchema,
  PublicLobbyTableSummarySchema,
  signInternalServicePayload,
  signTableInviteToken,
  verifyInternalServicePayload,
  verifyTableInviteToken,
  verifyWsAuthTicket,
} from '../src/index.js';

const SECRET = 'secreto-compartido-m4-lobby-minimo-32-chars!!';

describe('M4 Shared Lobby, Invite, Provisioning & Match Lifecycle Contracts', () => {
  it('generates 6-char unambiguous join codes and validates JoinByCodeRequestSchema', () => {
    const code = generateJoinCodeFromRandomBytes(new Uint8Array([0, 7, 15, 22, 31, 64]));
    expect(code).toHaveLength(6);
    for (const ch of code) {
      expect(JOIN_CODE_ALPHABET.includes(ch)).toBe(true);
    }
    expect(code).not.toMatch(/[0O1I]/);

    expect(JoinByCodeRequestSchema.safeParse({ code: code.toLowerCase() }).success).toBe(true);
    expect(JoinByCodeRequestSchema.safeParse({}).success).toBe(false);
    expect(JoinByCodeRequestSchema.safeParse({ code: '0O1IAB' }).success).toBe(false);
  });

  it('signs/verifies expiring invite tokens and enforces domain separation from WS tickets', () => {
    const now = 1_800_000_000_000;
    const tableId = '019a7e40-0000-7000-8000-000000000099';
    const inviteToken = signTableInviteToken({ tableId, exp: now + 600_000 }, SECRET);

    expect(verifyTableInviteToken(inviteToken, SECRET, now)).toEqual({
      tableId,
      exp: now + 600_000,
    });
    expect(verifyTableInviteToken(inviteToken, SECRET, now + 600_001)).toBeNull();
    expect(verifyTableInviteToken(`${inviteToken}tamper`, SECRET, now)).toBeNull();

    // Un token de invitación jamás es aceptado como ticket de handshake WS
    expect(verifyWsAuthTicket(inviteToken, SECRET, now)).toBeNull();

    const body = JSON.stringify({ roomId: tableId, mode: '1v1' });
    const sig = signInternalServicePayload(body, SECRET);
    expect(verifyInternalServicePayload(body, sig, SECRET)).toBe(true);
    expect(verifyInternalServicePayload(`${body} `, sig, SECRET)).toBe(false);
  });

  it('rejects private or PII fields on PublicLobbyTableSummarySchema (.strict)', () => {
    const validSummary = {
      id: '019a7e40-0000-7000-8000-000000000010',
      mode: '2v2',
      rulesetCode: 'ar-standard-v1',
      targetScore: 30,
      flor: true,
      turnTimeoutMs: 25_000,
      status: 'WAITING',
      ownerNickname: 'FacuCordoba',
      occupiedSeats: 2,
      maxSeats: 4,
      seats: [
        { seat: 0, team: 0, occupied: true, nickname: 'FacuCordoba' },
        { seat: 1, team: 1, occupied: true, nickname: 'LuciaSur' },
        { seat: 2, team: 0, occupied: false, nickname: null },
        { seat: 3, team: 1, occupied: false, nickname: null },
      ],
      createdAt: '2026-11-13T15:00:00.000Z',
    };

    expect(PublicLobbyTableSummarySchema.safeParse(validSummary).success).toBe(true);
    expect(
      PublicLobbyTableSummarySchema.safeParse({ ...validSummary, joinCode: 'ABCDEF' }).success,
    ).toBe(false);
    expect(
      PublicLobbyTableSummarySchema.safeParse({ ...validSummary, ownerEmail: 'a@b.com' }).success,
    ).toBe(false);

    expect(CreateTableRequestSchema.parse({ mode: '1v1' })).toEqual({
      mode: '1v1',
      visibility: 'PUBLIC',
      turnTimeoutMs: 25_000,
    });

    expect(ListTablesQuerySchema.parse({ mode: '2v2', targetScore: '15', flor: 'false' })).toEqual({
      mode: '2v2',
      targetScore: 15,
      flor: false,
      limit: 25,
    });
  });

  it('validates MatchLifecycleEventSchema discriminated union payloads', () => {
    const completed = {
      kind: 'match.completed',
      matchId: '019a7e40-0000-7000-8000-000000000123',
      roomId: '019a7e40-0000-7000-8000-000000000010',
      mode: '1v1',
      rulesetCode: 'ar-corto-15-v1',
      seedCommitment: 'a'.repeat(64),
      seedReveal: 'b'.repeat(64),
      startedAtMs: 1_800_000_000_000,
      endedAtMs: 1_800_000_090_000,
      winnerTeam: 0,
      scoresByTeam: { '0': 15, '1': 9 },
      reason: 'TARGET_SCORE',
      players: [
        { seat: 0, userId: 'u1', nickname: 'Ana', team: 0, score: 15, outcome: 'WIN' },
        { seat: 1, userId: 'u2', nickname: 'Beto', team: 1, score: 9, outcome: 'LOSS' },
      ],
      events: [{ seq: 1, type: 'game.started', ts: 1_800_000_000_000, payload: {} }],
    };

    expect(MatchLifecycleEventSchema.safeParse(completed).success).toBe(true);
  });
});
