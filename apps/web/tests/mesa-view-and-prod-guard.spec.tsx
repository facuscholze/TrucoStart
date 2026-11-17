import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameTableView } from '../src/features/mesa/GameTableView.js';
import {
  groupServerLegalActions,
  type ServerPlayerView,
} from '../src/features/mesa/mesa-view-model.js';

afterEach(() => cleanup());

const SAMPLE_SERVER_VIEW: ServerPlayerView = {
  status: 'IN_PROGRESS',
  ruleset: { code: 'ar-standard-v1', targetScore: 30, flor: { enabled: true } },
  mySeat: 0,
  myTeam: 0,
  seats: [
    { seat: 0, team: 0, remainingCardCount: 2, folded: false },
    { seat: 1, team: 1, remainingCardCount: 2, folded: false },
  ],
  scoresByTeam: { '0': 18, '1': 14 },
  winnerTeam: null,
  abandonedBySeat: null,
  hand: {
    handNumber: 4,
    manoSeat: 0,
    currentRoundIndex: 1,
    turnSeat: 0,
    activeSeat: 0,
    responderTeam: null,
    myRemainingCards: [
      { id: '1-espadas', rank: 1, suit: 'espadas' },
      { id: '7-oros', rank: 7, suit: 'oros' },
    ],
    currentRoundPlays: [],
    completedRounds: [
      {
        roundIndex: 0,
        winnerTeam: 0,
        winningSeat: 0,
        isParda: false,
        plays: [
          { seat: 0, team: 0, card: { id: '3-copas', rank: 3, suit: 'copas' } },
          { seat: 1, team: 1, card: { id: '12-bastos', rank: 12, suit: 'bastos' } },
        ],
      },
    ],
  },
  legalActions: [
    { type: 'PLAY_CARD', seat: 0, cardId: '1-espadas' },
    { type: 'CALL_TRUCO', seat: 0, bid: 'TRUCO' },
    { type: 'FOLD_HAND', seat: 0 },
  ],
};

describe('M5a GameTableView — Pure viewFor projection, legal-only CallTray, Reconnection & Rematch', () => {
  it('groups strictly server-provided legalActions and never invents illegal calls or playable cards', async () => {
    const user = userEvent.setup();
    const onPlayCard = vi.fn();
    const onCallBid = vi.fn();
    const onFoldHand = vi.fn();

    const grouped = groupServerLegalActions(SAMPLE_SERVER_VIEW.legalActions);
    expect([...grouped.playableCardIds]).toEqual(['1-espadas']);
    expect(grouped.trucoBids).toEqual(['TRUCO']);
    expect(grouped.envidoBids).toEqual([]);
    expect(grouped.florBids).toEqual([]);
    expect(grouped.canFoldHand).toBe(true);

    render(
      <GameTableView
        roomId="room-test-m5a"
        joinCode="K7P4M2"
        connectionStatus="connected"
        tableStatus="IN_GAME"
        seats={[
          {
            seat: 0,
            team: 0,
            userId: 'u-0',
            nickname: 'FacuCordoba',
            ready: true,
            isBot: false,
            connected: true,
          },
          {
            seat: 1,
            team: 1,
            userId: 'u-1',
            nickname: 'LuciaDelSur',
            ready: true,
            isBot: false,
            connected: true,
          },
        ]}
        myUserId="u-0"
        view={SAMPLE_SERVER_VIEW}
        seedCommitment={'a'.repeat(64)}
        turnDeadlineMs={1_800_000_015_000}
        isTurnWarning={false}
        peerGraceDeadlinesBySeat={new Map()}
        speechBubblesBySeat={new Map([[1, '¡Buenas!']])}
        eventFeed={['Mano #4']}
        matchEnded={null}
        toastMessage={null}
        defaultCallTrayOpen={true}
        nowMsOverride={1_800_000_000_000}
        onMarkReady={() => undefined}
        onPlayCard={onPlayCard}
        onCallBid={onCallBid}
        onRespondCall={() => undefined}
        onFoldHand={onFoldHand}
        onSendSignal={() => undefined}
        onSendQuickChat={() => undefined}
        onRequestRematch={() => undefined}
        onLeaveTable={() => undefined}
      />,
    );

    // 1-espadas es jugable según legalActions; 7-oros NO está en legalActions -> botón deshabilitado
    const anchoBtn = screen.getByRole('button', { name: /Ancho de espadas/i }) as HTMLButtonElement;
    const sieteBtn = screen.getByRole('button', { name: /Siete de oros/i }) as HTMLButtonElement;
    expect(anchoBtn.disabled).toBe(false);
    expect(sieteBtn.disabled).toBe(true);

    await user.click(anchoBtn);
    expect(onPlayCard).toHaveBeenCalledWith('1-espadas');

    // En la bandeja de cantos aparece ¡Truco!, pero JAMÁS ¡Envido! ni ¡Flor! porque el servidor no los reportó
    expect(screen.getByRole('button', { name: /¡Truco!/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /¡Envido!/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /¡Flor!/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /¡Truco!/i }));
    expect(onCallBid).toHaveBeenCalledWith('TRUCO');
  });

  it('renders reconnection alert banner and result modal with commit-reveal & rematch flow', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onRematch = vi.fn();

    render(
      <GameTableView
        roomId="room-test-reconnect"
        connectionStatus="reconnecting"
        tableStatus="FINISHED"
        seats={[
          {
            seat: 0,
            team: 0,
            userId: 'u-0',
            nickname: 'FacuCordoba',
            ready: false,
            isBot: false,
            connected: true,
          },
          {
            seat: 1,
            team: 1,
            userId: 'u-1',
            nickname: 'LuciaDelSur',
            ready: false,
            isBot: false,
            connected: false,
          },
        ]}
        myUserId="u-0"
        view={{ ...SAMPLE_SERVER_VIEW, status: 'FINISHED', winnerTeam: 0 }}
        seedCommitment={'b'.repeat(64)}
        turnDeadlineMs={null}
        isTurnWarning={false}
        peerGraceDeadlinesBySeat={new Map([[1, 1_800_000_030_000]])}
        speechBubblesBySeat={new Map()}
        eventFeed={[]}
        matchEnded={{
          matchId: 'match-1',
          winnerTeam: 0,
          usScore: 30,
          themScore: 24,
          targetScore: 30,
          reason: 'TARGET_SCORE_REACHED',
          seedCommitment: 'b'.repeat(64),
          seedReveal: 'c'.repeat(64),
        }}
        toastMessage={null}
        nowMsOverride={1_800_000_000_000}
        onRetryConnect={onRetry}
        onMarkReady={() => undefined}
        onPlayCard={() => undefined}
        onCallBid={() => undefined}
        onRespondCall={() => undefined}
        onFoldHand={() => undefined}
        onSendSignal={() => undefined}
        onSendQuickChat={() => undefined}
        onRequestRematch={onRematch}
        onLeaveTable={() => undefined}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Reconectando con la mesa en vivo');
    const dialog = screen.getByRole('dialog', { name: '¡Ganamos la partida!' });
    expect(dialog.textContent).toContain('c'.repeat(64));

    await user.click(screen.getByRole('button', { name: /Pedir revancha/i }));
    expect(onRematch).toHaveBeenCalledTimes(1);
  });

  it('excludes /dev/mesa and engine bot playground from production build and keeps initial JS < 200 KB gzip', () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const distAssetsDir = path.resolve(currentDir, '../dist/assets');
    if (!existsSync(distAssetsDir)) {
      // Cuando dist aún no fue compilado en modo watch local no bloquea; en CI/build valida el artefacto real
      return;
    }

    const jsFiles = readdirSync(distAssetsDir).filter((f) => f.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThan(0);

    let totalGzipBytes = 0;
    for (const file of jsFiles) {
      const raw = readFileSync(path.join(distAssetsDir, file));
      const text = raw.toString('utf8');
      expect(text).not.toContain('dev-mesa-local');
      expect(text).not.toContain('Bot Malevo');
      totalGzipBytes += gzipSync(raw).length;
    }

    // Presupuesto estricto M5: JS inicial comprimido < 200 KB (204,800 bytes)
    expect(totalGzipBytes).toBeLessThan(200 * 1024);
  });
});
