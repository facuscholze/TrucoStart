import type { LeagueDetail, LeagueStandingRow, LeagueSummary } from '@truco/shared';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeagueDetailScreen } from '../src/features/leagues/LeagueDetailScreen.js';
import { LeaguesScreen } from '../src/features/leagues/LeaguesScreen.js';
import { MyNextLeagueMatch } from '../src/features/leagues/MyNextLeagueMatch.js';
import { LeagueStandings } from '../src/features/leagues/LeagueStandings.js';

const api = vi.hoisted(() => ({
  listLeaguesRequest: vi.fn(),
  getLeagueDetailRequest: vi.fn(),
  joinLeagueRequest: vi.fn(),
  leaveLeagueRequest: vi.fn(),
  rescheduleLeagueMatchRequest: vi.fn(),
}));

vi.mock('../src/lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as Record<string, unknown>), ...api };
});

function summary(overrides: Partial<LeagueSummary> = {}): LeagueSummary {
  return {
    id: 'aaaaaaaa-1111-4111-8111-111111111111',
    name: 'Liga de los jueves',
    mode: '1v1',
    division: 'PLATA',
    status: 'ACTIVE',
    official: false,
    seasonLabel: 'Temporada 2027-1',
    startsAt: '2027-01-04T12:00:00.000Z',
    endsAt: '2027-03-01T12:00:00.000Z',
    rulesetCode: 'ar-standard-v1',
    targetScore: 30,
    florEnabled: true,
    turnTimeoutMs: 25_000,
    capacity: 16,
    participantCount: 8,
    currentRound: 2,
    registrationClosesAt: '2027-01-03T12:00:00.000Z',
    finishedAt: null,
    createdByNickname: 'Organizador',
    isParticipant: true,
    isOrganizer: false,
    prizes: [],
    ...overrides,
  };
}

function standing(overrides: Partial<LeagueStandingRow> = {}): LeagueStandingRow {
  return {
    position: 1,
    userId: 'user-1',
    nickname: 'Ana',
    status: 'ACTIVE',
    played: 3,
    wins: 3,
    losses: 0,
    noShows: 0,
    points: 9,
    scoreFor: 90,
    scoreAgainst: 40,
    scoreDifference: 50,
    seed: 1,
    decidedBy: null,
    movement: 'NONE',
    eligibleToMove: true,
    ...overrides,
  };
}

function detail(overrides: Partial<LeagueDetail> = {}): LeagueDetail {
  return {
    ...summary(),
    promotion: { promotions: 1, relegations: 1, minMatchesToMove: 1 },
    schedule: {
      format: 'ROUNDS',
      rounds: 3,
      daysBetweenRounds: 7,
      roundWindowHours: 48,
      maxReschedulesPerMatch: 2,
      rescheduleMinHoursBeforeDeadline: 12,
      rescheduleExtensionHours: 48,
    },
    standings: [
      standing(),
      standing({
        position: 2,
        userId: 'user-2',
        nickname: 'Beto',
        points: 6,
        wins: 2,
        decidedBy: 'POINTS',
      }),
    ],
    rounds: [
      {
        id: 'round-1',
        number: 1,
        status: 'OPEN',
        startsAt: '2027-01-04T12:00:00.000Z',
        deadlineAt: '2027-01-06T12:00:00.000Z',
        closedAt: null,
      },
    ],
    matches: [],
    myNextMatch: null,
    nextRoundStartsAt: null,
    myProjectedMovement: 'NONE',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // Sin `jest-dom` en este paquete: se afirma sobre el nodo y se limpia a mano.
  cleanup();
  vi.useRealTimers();
});

describe('Ligas — listado', () => {
  it('muestra las ligas con su división, estado y jugadores', async () => {
    api.listLeaguesRequest.mockResolvedValue({ items: [summary()], nextCursor: null });
    const onOpen = vi.fn();
    render(<LeaguesScreen onOpenLeague={onOpen} />);
    const card = await screen.findByRole('button', { name: /Liga de los jueves/ });
    expect(within(card).getByText(/Plata · 1v1/)).toBeTruthy();
    // La pantalla deja explícito que la inscripción es gratuita.
    expect(screen.getByText(/la inscripción nunca se paga/i)).toBeTruthy();
  });

  it('avisa cuando no hay ligas en la categoría', async () => {
    api.listLeaguesRequest.mockResolvedValue({ items: [], nextCursor: null });
    render(<LeaguesScreen onOpenLeague={vi.fn()} />);
    expect(await screen.findByText(/No hay ligas en esta categoría/)).toBeTruthy();
  });

  it('filtra por división y no rompe si la API falla', async () => {
    api.listLeaguesRequest.mockResolvedValue({ items: [], nextCursor: null });
    render(<LeaguesScreen onOpenLeague={vi.fn()} />);
    await screen.findByText(/No hay ligas/);
    await userEvent.click(screen.getByRole('button', { name: 'Oro' }));
    await waitFor(() => {
      expect(api.listLeaguesRequest).toHaveBeenLastCalledWith(
        expect.objectContaining({ division: 'ORO' }),
      );
    });

    api.listLeaguesRequest.mockRejectedValue(new Error('boom'));
    // «Terminadas» cambia el filtro: con el que ya estaba activo no habría nueva carga.
    await userEvent.click(screen.getByRole('button', { name: 'Terminadas' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/No pudimos cargar las ligas/);
  });
});

describe('Ligas — tabla de posiciones', () => {
  it('es una tabla accesible con encabezados de columna', () => {
    render(<LeagueStandings standings={[standing()]} />);
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: /Jugador/ })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: /Pts/ })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Ana' })).toBeTruthy();
  });

  it('explica el desempate que decidió la posición', () => {
    render(
      <LeagueStandings
        standings={[
          standing({ decidedBy: 'HEAD_TO_HEAD' }),
          standing({ position: 2, nickname: 'Beto' }),
        ]}
      />,
    );
    expect(screen.getByText(/Desempata por resultado directo/)).toBeTruthy();
  });

  it('marca ascenso, descenso y al jugador propio con texto, no sólo color', () => {
    render(
      <LeagueStandings
        currentUserId="user-2"
        standings={[
          standing({ movement: 'PROMOTION' }),
          standing({ position: 2, userId: 'user-2', nickname: 'Beto', movement: 'RELEGATION' }),
        ]}
      />,
    );
    expect(screen.getByText('Asciende')).toBeTruthy();
    expect(screen.getByText('Desciende')).toBeTruthy();
    expect(screen.getByText('(vos)')).toBeTruthy();
    // El jugador propio queda marcado para el lector de pantalla.
    const meRow = screen.getByText('Beto').closest('tr')!;
    expect(meRow.getAttribute('aria-current')).toBe('true');
  });

  it('dice que un inactivo no puede moverse en vez de mostrarlo como ascendido', () => {
    render(
      <LeagueStandings
        standings={[standing({ played: 1, eligibleToMove: false, movement: 'PROMOTION' })]}
      />,
    );
    expect(screen.getByText(/Sin partidas para mover/)).toBeTruthy();
    expect(screen.queryByText('Asciende')).toBeNull();
  });
});

describe('Ligas — mi próxima partida', () => {
  const match = {
    id: 'match-1',
    roundNumber: 2,
    status: 'READY' as const,
    homeUserId: 'user-1',
    homeNickname: 'Ana',
    awayUserId: 'user-2',
    awayNickname: 'Beto',
    homeScore: null,
    awayScore: null,
    winnerUserId: null,
    forfeitReason: null,
    roomId: 'room-1',
    deadlineAt: '2027-01-06T12:00:00.000Z',
    reschedulesUsed: 0,
    maxReschedules: 2,
    canReschedule: true,
    isMine: true,
  };

  it('muestra el cruce, el plazo y el botón para entrar a la mesa', () => {
    const onOpenRoom = vi.fn();
    render(<MyNextLeagueMatch match={match} onOpenRoom={onOpenRoom} />);
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByText('Beto')).toBeTruthy();
    expect(screen.getByText(/Jornada 2/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Entrar a la mesa' })).toBeTruthy();
  });

  it('sin sala todavía, no ofrece entrar y lo explica', () => {
    render(<MyNextLeagueMatch match={{ ...match, roomId: null }} onOpenRoom={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Entrar a la mesa' })).toBeNull();
    expect(screen.getByText(/La mesa se abre cuando arranque la jornada/)).toBeTruthy();
  });

  it('sin partidas pendientes lo dice en lugar de mostrar un cartel vacío', () => {
    render(<MyNextLeagueMatch match={null} onOpenRoom={vi.fn()} />);
    expect(screen.getByText(/No tenés partidas pendientes/)).toBeTruthy();
  });

  it('pide motivo y reprograma; después avisa al padre para refrescar', async () => {
    api.rescheduleLeagueMatchRequest.mockResolvedValue({
      matchId: 'match-1',
      deadlineAt: '2027-01-08T12:00:00.000Z',
      reschedulesUsed: 1,
    });
    const onRescheduled = vi.fn();
    render(<MyNextLeagueMatch match={match} onOpenRoom={vi.fn()} onRescheduled={onRescheduled} />);
    await userEvent.click(screen.getByRole('button', { name: /Pedir reprogramación/ }));
    const reason = screen.getByLabelText(/Motivo de la reprogramación/);
    await userEvent.type(reason, 'Trabajo ese día');
    await userEvent.click(screen.getByRole('button', { name: /Confirmar reprogramación/ }));
    await waitFor(() => {
      expect(api.rescheduleLeagueMatchRequest).toHaveBeenCalledWith('match-1', 'Trabajo ese día');
    });
    expect(onRescheduled).toHaveBeenCalled();
  });

  it('no reprograma sin motivo y lo explica', async () => {
    render(<MyNextLeagueMatch match={match} onOpenRoom={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Pedir reprogramación/ }));
    await userEvent.click(screen.getByRole('button', { name: /Confirmar reprogramación/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/por qué necesitás mover/i);
    expect(api.rescheduleLeagueMatchRequest).not.toHaveBeenCalled();
  });

  it('cuando no quedan reprogramaciones, no ofrece el botón', () => {
    render(<MyNextLeagueMatch match={{ ...match, reschedulesUsed: 2 }} onOpenRoom={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Pedir reprogramación/ })).toBeNull();
    expect(screen.getByText(/Sin reprogramaciones disponibles/)).toBeTruthy();
  });
});

describe('Ligas — detalle', () => {
  it('muestra tabla, jornadas y la inscripción gratuita', async () => {
    api.getLeagueDetailRequest.mockResolvedValue(detail());
    render(
      <LeagueDetailScreen
        leagueId="aaaaaaaa-1111-4111-8111-111111111111"
        currentUserId="user-1"
        onOpenRoom={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Liga de los jueves' })).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText(/Inscripción gratuita/)).toBeTruthy();
    expect(screen.getByText(/Jornada 1/)).toBeTruthy();
  });

  it('ofrece inscribirse sólo cuando la inscripción está abierta', async () => {
    api.getLeagueDetailRequest.mockResolvedValue(
      detail({ status: 'REGISTRATION', isParticipant: false }),
    );
    api.joinLeagueRequest.mockResolvedValue({ joined: true });
    render(
      <LeagueDetailScreen
        leagueId="aaaaaaaa-1111-4111-8111-111111111111"
        onOpenRoom={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    const join = await screen.findByRole('button', { name: /Inscribirme \(gratis\)/ });
    await userEvent.click(join);
    await waitFor(() => expect(api.joinLeagueRequest).toHaveBeenCalled());
  });

  it('no ofrece inscribirse cuando la liga ya empezó', async () => {
    api.getLeagueDetailRequest.mockResolvedValue(
      detail({ status: 'ACTIVE', isParticipant: false }),
    );
    render(
      <LeagueDetailScreen
        leagueId="aaaaaaaa-1111-4111-8111-111111111111"
        onOpenRoom={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    await screen.findByRole('heading', { name: 'Liga de los jueves' });
    expect(screen.queryByRole('button', { name: /Inscribirme/ })).toBeNull();
  });

  it('si la liga no carga, lo dice y deja volver', async () => {
    api.getLeagueDetailRequest.mockRejectedValue(new Error('404'));
    const onBack = vi.fn();
    render(
      <LeagueDetailScreen
        leagueId="aaaaaaaa-1111-4111-8111-111111111111"
        onOpenRoom={vi.fn()}
        onBack={onBack}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(/No pudimos cargar la liga/);
    await userEvent.click(screen.getByRole('button', { name: /Volver a ligas/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it('lista los premios con el aviso de que las monedas no valen dinero', async () => {
    api.getLeagueDetailRequest.mockResolvedValue(
      detail({ prizes: [{ position: 1, coins: 250, cosmeticId: null, cosmeticName: null }] }),
    );
    render(
      <LeagueDetailScreen
        leagueId="aaaaaaaa-1111-4111-8111-111111111111"
        onOpenRoom={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(await screen.findByText(/250 monedas virtuales/)).toBeTruthy();
    expect(screen.getByText(/no valen dinero, no se compran ni se transfieren/)).toBeTruthy();
  });
});
