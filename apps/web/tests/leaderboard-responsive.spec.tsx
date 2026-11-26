import type { LeaderboardResponse } from '@truco/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeaderboardScreen } from '../src/features/ratings/LeaderboardScreen.js';

const api = vi.hoisted(() => ({ getLeaderboardRequest: vi.fn() }));

vi.mock('../src/lib/api-client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...api,
}));

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

const GLOBAL_RANKING: LeaderboardResponse = {
  period: 'GLOBAL',
  mode: '1v1',
  season: {
    id: '01900000-0000-7000-8000-000000000001',
    label: 'Temporada 1',
    startsAt: '2026-11-19T00:00:00.000Z',
    endsAt: '2027-02-17T00:00:00.000Z',
    secondsUntilReset: 7_776_000,
  },
  minimumMatches: 5,
  minimumOpponents: 3,
  items: [
    {
      position: 1,
      userId: '019a7e40-0000-7000-8000-000000000101',
      nickname: 'La Dama de Oro',
      score: 1678,
      rating: 1678,
      division: 'Oro',
      matchesPlayed: 34,
      opponentsCount: 18,
      wins: 22,
    },
  ],
  nextCursor: null,
  generatedAt: '2026-11-19T12:00:00.000Z',
};

const WEEKLY_RANKING: LeaderboardResponse = {
  ...GLOBAL_RANKING,
  period: 'WEEKLY',
  items: GLOBAL_RANKING.items.map((item) => ({ ...item, score: 13.4 })),
};

describe('Leaderboard responsive presentation', () => {
  it('shows a readable mobile list and avoids repeating the global rating as a score', async () => {
    api.getLeaderboardRequest.mockResolvedValue(GLOBAL_RANKING);
    render(<LeaderboardScreen onNavigate={vi.fn()} />);

    const mobileList = await screen.findByRole('list', { name: 'Rankings competitivos' });
    expect(
      within(mobileList).getByRole('button', {
        name: 'Abrir perfil de jugador: La Dama de Oro',
      }),
    ).toBeTruthy();
    expect(within(mobileList).getByText('34')).toBeTruthy();
    expect(within(mobileList).getByText('18')).toBeTruthy();
    expect(within(mobileList).getByText('22')).toBeTruthy();

    expect(screen.getByRole('columnheader', { name: 'Puntaje' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Variación' })).toBeNull();
    expect(within(mobileList).queryByText('+1678')).toBeNull();
  });

  it('shows a separate period variation beside the current rating for weekly rankings', async () => {
    api.getLeaderboardRequest
      .mockResolvedValueOnce(GLOBAL_RANKING)
      .mockResolvedValueOnce(WEEKLY_RANKING);
    render(<LeaderboardScreen onNavigate={vi.fn()} />);

    await screen.findByRole('list', { name: 'Rankings competitivos' });
    fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'WEEKLY' } });

    await waitFor(() => {
      expect(api.getLeaderboardRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({ period: 'WEEKLY' }),
      );
    });
    const mobileList = await screen.findByRole('list', { name: 'Rankings competitivos' });
    expect(within(mobileList).getByText('+13')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Variación' })).toBeTruthy();
  });
});
