import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WsEnvelope } from '@truco/shared';
import type * as ApiClientModule from '../src/lib/api-client.js';

type AuthFn = (cb: (data: { token?: string }) => void) => void | Promise<void>;

interface FakeSocketInstance {
  auth: AuthFn;
  listeners: Map<string, Set<(...args: unknown[]) => void>>;
  ioListeners: Map<string, Set<(...args: unknown[]) => void>>;
  emittedEnvelopes: WsEnvelope[];
  connectCalls: number;
  connected: boolean;
  disconnected: boolean;
}

const fakeSockets: FakeSocketInstance[] = [];

vi.mock('socket.io-client', () => ({
  io: (_url: string, opts: { auth: AuthFn }) => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const ioListeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const emittedEnvelopes: WsEnvelope[] = [];
    const instance: FakeSocketInstance = {
      auth: opts.auth,
      listeners,
      ioListeners,
      emittedEnvelopes,
      connectCalls: 0,
      connected: false,
      disconnected: false,
    };
    fakeSockets.push(instance);

    return {
      get connected() {
        return instance.connected;
      },
      on(event: string, fn: (...args: unknown[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
        return this;
      },
      emit(event: string, payload: unknown) {
        if (event === 'envelope') {
          emittedEnvelopes.push(payload as WsEnvelope);
        }
        return this;
      },
      connect() {
        instance.connectCalls += 1;
        return this;
      },
      disconnect() {
        instance.disconnected = true;
        return this;
      },
      io: {
        on(event: string, fn: (...args: unknown[]) => void) {
          if (!ioListeners.has(event)) ioListeners.set(event, new Set());
          ioListeners.get(event)!.add(fn);
        },
      },
    };
  },
}));

const mintMock = vi.fn();

vi.mock('../src/lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    ensureGuestOrActiveSession: vi.fn().mockResolvedValue({
      id: '01950000-0000-7000-8000-000000000001',
      nickname: 'FacuCordoba',
      isGuest: true,
    }),
    mintSingleUseWsTicket: (...args: unknown[]) => mintMock(...args),
  };
});

function makeFakeTicket(sessionId: string, jti: string): string {
  const claimsJson = JSON.stringify({
    v: 1,
    jti,
    userId: '01950000-0000-7000-8000-000000000001',
    sessionId,
    nickname: 'FacuCordoba',
    isGuest: true,
    iat: 1_700_000_000,
    exp: 1_700_000_030,
  });
  const base64url = btoa(claimsJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `${base64url}.fakesignature`;
}

import { useLiveGameRoom } from '../src/features/mesa/useLiveGameRoom.js';

describe('useLiveGameRoom — single-use ws-ticket minting, game.rejoin & table.ready rematch', () => {
  beforeEach(() => {
    fakeSockets.length = 0;
    mintMock.mockReset();
  });

  it('mints a fresh ws-ticket on initial connect AND on reconnect, sending game.rejoin with lastSeq', async () => {
    const sessionId = '01950000-0000-7000-8000-000000000099';
    const ticket1 = makeFakeTicket(sessionId, 'jti-1');
    const ticket2 = makeFakeTicket(sessionId, 'jti-2');

    mintMock
      .mockResolvedValueOnce({ ticket: ticket1, expiresAt: '2026-11-13T12:00:30.000Z' })
      .mockResolvedValueOnce({ ticket: ticket2, expiresAt: '2026-11-13T12:01:00.000Z' });

    const roomId = '01950000-0000-7000-8000-000000000555';
    const { result, unmount } = renderHook(() =>
      useLiveGameRoom({ roomId, joinCode: 'MATE99', wsBaseUrl: 'http://127.0.0.1:3002' }),
    );

    await waitFor(() => {
      expect(fakeSockets).toHaveLength(1);
    });
    const sock = fakeSockets[0]!;

    // 1. Simulate Socket.IO invoking auth(cb) on initial connect
    let firstAuthPayload: { token?: string } | undefined;
    await act(async () => {
      await sock.auth((payload) => {
        firstAuthPayload = payload;
      });
    });
    expect(mintMock).toHaveBeenCalledTimes(1);
    expect(firstAuthPayload).toEqual({ token: ticket1 });

    // Trigger 'connect' -> sends initial 'table.join'
    act(() => {
      sock.connected = true;
      for (const fn of sock.listeners.get('connect') ?? []) fn();
    });
    expect(sock.emittedEnvelopes).toHaveLength(1);
    expect(sock.emittedEnvelopes[0]?.type).toBe('table.join');
    expect(sock.emittedEnvelopes[0]?.payload).toEqual({ roomId });

    // Receive game.started (seq = 4)
    const startedEnvelope: WsEnvelope = {
      eventId: '01950000-0000-7000-8000-000000000111',
      type: 'game.started',
      seq: 4,
      ts: 1_700_000_005_000,
      payload: {
        roomId,
        matchId: '01950000-0000-7000-8000-000000000777',
        rulesetId: 'AR_CLASICO_30_SIN_FLOR_V1',
        mode: '1v1',
        targetScore: 30,
        florEnabled: false,
        yourSeat: 0,
        seedCommitment: 'a'.repeat(64),
      },
    };

    act(() => {
      for (const fn of sock.listeners.get('envelope') ?? []) fn(startedEnvelope);
    });

    // 2. Simulate transport drop + Socket.IO reconnect invoking auth(cb) AGAIN
    act(() => {
      sock.connected = false;
      for (const fn of sock.listeners.get('disconnect') ?? []) fn('transport close');
      for (const fn of sock.ioListeners.get('reconnect_attempt') ?? []) fn();
    });
    expect(result.current.connectionStatus).toBe('reconnecting');

    let secondAuthPayload: { token?: string } | undefined;
    await act(async () => {
      await sock.auth((payload) => {
        secondAuthPayload = payload;
      });
    });

    // Must mint a brand-new single-use ticket (never reuse ticket1)
    expect(mintMock).toHaveBeenCalledTimes(2);
    expect(secondAuthPayload).toEqual({ token: ticket2 });
    expect(secondAuthPayload?.token).not.toBe(ticket1);

    // Reconnected -> emits authoritative game.rejoin with decoded sessionId + lastSeq=4
    act(() => {
      sock.connected = true;
      for (const fn of sock.listeners.get('connect') ?? []) fn();
    });
    expect(result.current.connectionStatus).toBe('connected');
    expect(sock.emittedEnvelopes).toHaveLength(2);
    expect(sock.emittedEnvelopes[1]?.type).toBe('game.rejoin');
    expect(sock.emittedEnvelopes[1]?.payload).toEqual({
      roomId,
      sessionId,
      lastSeq: 4,
    });

    // 3. Rematch CTA emits table.ready { roomId, ready: true }
    act(() => {
      result.current.onRequestRematch();
    });
    expect(sock.emittedEnvelopes).toHaveLength(3);
    expect(sock.emittedEnvelopes[2]?.type).toBe('table.ready');
    expect(sock.emittedEnvelopes[2]?.payload).toEqual({
      roomId,
      ready: true,
    });

    unmount();
    expect(sock.disconnected).toBe(true);
  });
});
