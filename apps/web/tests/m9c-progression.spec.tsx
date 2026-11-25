import type { AuthUserSummary, ProgressionSummary } from '@truco/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressionScreen } from '../src/features/progression/ProgressionScreen.js';

const api = vi.hoisted(() => ({
  claimProgressionMissionRequest: vi.fn(),
  getMyProgressionRequest: vi.fn(),
  markProgressionNotificationReadRequest: vi.fn(),
  redeemProgressionCosmeticRequest: vi.fn(),
}));

vi.mock('../src/lib/api-client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...api,
}));

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

const CURRENT_USER: AuthUserSummary = {
  id: '019a7e40-0000-7000-8000-0000000000a1',
  email: 'jugador@truco.ar',
  emailVerified: true,
  nickname: 'TanaDelSur',
  isGuest: false,
  role: 'PLAYER',
  status: 'ACTIVE',
  createdAt: '2026-11-18T12:00:00.000Z',
};

const BASE_SUMMARY: ProgressionSummary = {
  level: 4,
  xpTotal: 735,
  xpInLevel: 35,
  xpForNextLevel: 250,
  levelProgress: 0.14,
  wallet: {
    balance: 26,
    currencyType: 'VIRTUAL_COIN',
    hasEconomicValue: false,
    playerTransfersEnabled: false,
    moneyPurchasesEnabled: false,
  },
  achievements: [
    {
      id: 'first_match',
      titleKey: 'progression.achievements.firstMatch.title',
      descriptionKey: 'progression.achievements.firstMatch.description',
      icon: 'cards',
      condition: { kind: 'MATCHES_COMPLETED', target: 1 },
      progress: 1,
      target: 1,
      rewardXp: 10,
      rewardCoins: 3,
      unlockedAt: '2026-11-19T10:00:00.000Z',
    },
  ],
  missions: [
    {
      id: '019a7e40-0000-7000-8000-0000000000b1',
      templateId: 'daily_play_match',
      period: 'DAILY',
      titleKey: 'progression.missions.dailyPlay.title',
      descriptionKey: 'progression.missions.dailyPlay.description',
      progress: 1,
      target: 1,
      rewardXp: 10,
      rewardCoins: 3,
      periodEndsAt: '2026-11-20T00:00:00.000Z',
      completedAt: '2026-11-19T10:00:00.000Z',
      claimedAt: null,
    },
  ],
  cosmetics: [
    {
      id: 'frame_sunrise',
      nameKey: 'progression.cosmetics.sunrise.name',
      descriptionKey: 'progression.cosmetics.sunrise.description',
      category: 'AVATAR_FRAME',
      priceCoins: 20,
      icon: 'sunrise',
      owned: false,
    },
  ],
  notifications: [
    {
      id: '019a7e40-0000-7000-8000-0000000000c1',
      kind: 'ACHIEVEMENT_UNLOCKED',
      payload: {
        achievementId: 'first_match',
        titleKey: 'progression.achievements.firstMatch.title',
      },
      createdAt: '2026-11-19T10:00:00.000Z',
      readAt: null,
    },
  ],
};

const CLAIMED_SUMMARY: ProgressionSummary = {
  ...BASE_SUMMARY,
  wallet: { ...BASE_SUMMARY.wallet, balance: 29 },
  missions: BASE_SUMMARY.missions.map((mission) => ({
    ...mission,
    claimedAt: '2026-11-19T12:00:00.000Z',
  })),
};

const REDEEMED_SUMMARY: ProgressionSummary = {
  ...CLAIMED_SUMMARY,
  wallet: { ...CLAIMED_SUMMARY.wallet, balance: 9 },
  cosmetics: CLAIMED_SUMMARY.cosmetics.map((cosmetic) => ({ ...cosmetic, owned: true })),
};

describe('M9c — pantalla de progreso del jugador', () => {
  it('muestra nivel, XP, moneda sin valor económico y permite reclamar una misión', async () => {
    api.getMyProgressionRequest.mockResolvedValue(BASE_SUMMARY);
    api.claimProgressionMissionRequest.mockResolvedValue({
      claimed: true,
      progression: CLAIMED_SUMMARY,
    });
    api.redeemProgressionCosmeticRequest.mockResolvedValue({
      acquired: true,
      progression: REDEEMED_SUMMARY,
    });

    render(<ProgressionScreen currentUser={CURRENT_USER} onNavigate={vi.fn()} />);

    expect(await screen.findByRole('heading', { name: 'Tu progreso' })).toBeTruthy();
    expect(screen.getByText('Monedas simbólicas')).toBeTruthy();
    expect(
      screen.getAllByText('Sin valor económico · no transferibles · no se compran con dinero.')
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Una mano más')).toBeTruthy();
    const claimButton = screen.getByRole('button', { name: 'Reclamar' });
    fireEvent.click(claimButton);
    await waitFor(() =>
      expect(api.claimProgressionMissionRequest).toHaveBeenCalledWith(BASE_SUMMARY.missions[0]!.id),
    );
    expect(await screen.findByRole('button', { name: 'Reclamada' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Canjear' }));
    await waitFor(() =>
      expect(api.redeemProgressionCosmeticRequest).toHaveBeenCalledWith('frame_sunrise'),
    );
    expect(await screen.findByRole('button', { name: 'Desbloqueado' })).toBeTruthy();

    const readButton = screen.getByRole('button', { name: 'Marcar como leída' });
    fireEvent.click(readButton);
    await waitFor(() =>
      expect(api.markProgressionNotificationReadRequest).toHaveBeenCalledWith(
        BASE_SUMMARY.notifications[0]!.id,
      ),
    );
    expect(screen.queryByRole('button', { name: 'Marcar como leída' })).toBeNull();
  });

  it('invita a iniciar sesión antes de mostrar una cuenta de progreso', () => {
    const navigate = vi.fn();
    render(<ProgressionScreen currentUser={null} onNavigate={navigate} />);
    expect(screen.getByRole('heading', { name: 'Ingresá para guardar tu progreso' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cuenta' }));
    expect(navigate).toHaveBeenCalledWith('/acceso');
    expect(api.getMyProgressionRequest).not.toHaveBeenCalled();
  });
});
