import type { TournamentDetailResponse, TournamentSummary } from '@truco/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TournamentBracket } from '../src/features/tournaments/TournamentBracket.js';
import { TournamentDetailScreen } from '../src/features/tournaments/TournamentDetailScreen.js';
import {
  TOURNAMENT_STATUS_LABELS_ES_AR,
  describeMatch,
  groupBracket,
} from '../src/features/tournaments/tournament-bracket.js';

const api = vi.hoisted(() => ({
  listTournamentsRequest: vi.fn(),
  getTournamentDetailRequest: vi.fn(),
  registerForTournamentRequest: vi.fn(),
  unregisterFromTournamentRequest: vi.fn(),
  checkInTournamentRequest: vi.fn(),
  resolveTournamentJoinCodeRequest: vi.fn(),
}));

vi.mock('../src/lib/api-client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...api,
}));

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

const USER_ID = '019a7e40-0000-7000-8000-0000000000a1';

function match(overrides: Partial<TournamentDetailResponse['matches'][number]> = {}) {
  return {
    id: '019a7e40-0000-7000-8000-0000000000m1',
    round: 1,
    slot: 1,
    bracket: 'WINNERS' as const,
    status: 'READY' as const,
    homeNickname: 'TanaDelSur',
    awayNickname: 'Envidioso',
    homeUserId: USER_ID,
    awayUserId: '019a7e40-0000-7000-8000-0000000000b2',
    winnerUserId: null,
    roomId: null,
    deadlineAt: null,
    forfeitReason: null,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

const SUMMARY: TournamentSummary = {
  id: '019a7e40-0000-7000-8000-000000000001',
  name: 'Copa de los Viernes',
  format: 'SINGLE_ELIMINATION',
  visibility: 'PRIVATE',
  status: 'IN_PROGRESS',
  mode: '1v1',
  rulesetCode: 'ar-corto-15-flor-v1',
  targetScore: 15,
  florEnabled: true,
  turnTimeoutMs: 25000,
  capacity: 4,
  registeredCount: 4,
  checkedInCount: 4,
  joinCode: 'ABC234',
  registrationClosesAt: '2026-11-26T12:30:00.000Z',
  checkInClosesAt: '2026-11-26T12:40:00.000Z',
  startsAt: '2026-11-26T12:41:00.000Z',
  finishedAt: null,
  cancelledReason: null,
  createdByNickname: 'Organizadora',
  isParticipant: true,
  isOrganizer: true,
  prizes: [
    { position: 1, coins: 100, cosmeticId: null, cosmeticName: null },
    { position: 2, coins: 40, cosmeticId: null, cosmeticName: null },
  ],
};

describe('agrupado del cuadro', () => {
  it('agrupa por llave y ronda en orden, sin secciones vacías', () => {
    const sections = groupBracket(
      [
        match({ id: 'a', round: 1, slot: 1 }),
        match({ id: 'b', round: 1, slot: 2 }),
        match({ id: 'c', round: 2, slot: 1 }),
      ],
      'SINGLE_ELIMINATION',
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]!.bracket).toBe('WINNERS');
    expect(sections[0]!.rounds.map((round) => round.round)).toEqual([1, 2]);
    expect(sections[0]!.rounds[0]!.matches.map((m) => m.slot)).toEqual([1, 2]);
  });

  it('en eliminación simple no muestra llave de perdedores aunque llegue una fila', () => {
    const sections = groupBracket(
      [match({ id: 'a' }), match({ id: 'b', bracket: 'LOSERS', round: 1 })],
      'SINGLE_ELIMINATION',
    );
    expect(sections.map((section) => section.bracket)).toEqual(['WINNERS']);
  });

  it('en eliminación doble ordena ganadores, perdedores y gran final', () => {
    const sections = groupBracket(
      [
        match({ id: 'g', bracket: 'GRAND_FINAL', round: 1 }),
        match({ id: 'l', bracket: 'LOSERS', round: 1 }),
        match({ id: 'w', bracket: 'WINNERS', round: 1 }),
      ],
      'DOUBLE_ELIMINATION',
    );
    expect(sections.map((section) => section.bracket)).toEqual([
      'WINNERS',
      'LOSERS',
      'GRAND_FINAL',
    ]);
  });

  it('describe el cruce sin depender del color', () => {
    expect(describeMatch(match())).toBe('Listo para jugar');
    expect(describeMatch(match({ status: 'SCHEDULED' }))).toBe('En juego');
    expect(describeMatch(match({ status: 'COMPLETED', winnerUserId: USER_ID }))).toContain(
      'Ganó TanaDelSur',
    );
    expect(describeMatch(match({ status: 'FORFEITED', forfeitReason: 'NO_SHOW' }))).toContain(
      'sin presentarse',
    );
    expect(describeMatch(match({ homeNickname: null, awayNickname: null }))).toBe('A confirmar');
    expect(describeMatch(match({ awayNickname: null }))).toBe('Esperando rival');
  });

  it('tiene etiqueta en rioplatense para cada estado del ciclo', () => {
    for (const status of [
      'DRAFT',
      'REGISTRATION',
      'CHECK_IN',
      'IN_PROGRESS',
      'FINISHED',
      'CANCELLED',
    ]) {
      expect(TOURNAMENT_STATUS_LABELS_ES_AR[status]).toBeTruthy();
    }
  });
});

describe('cuadro en pantalla', () => {
  it('renderiza rondas y da un nombre accesible completo por cruce', () => {
    render(
      <TournamentBracket
        matches={[match({ id: 'a' }), match({ id: 'b', round: 2, slot: 1, status: 'SCHEDULED' })]}
        format="SINGLE_ELIMINATION"
        currentUserId={USER_ID}
      />,
    );
    expect(screen.getByText('Llave de ganadores')).toBeTruthy();
    expect(screen.getByText('Primera ronda')).toBeTruthy();
    expect(screen.getByText('Ronda 2')).toBeTruthy();
    // El nombre accesible incluye ronda, cruce y estado.
    expect(screen.getByLabelText('Ronda 1, cruce 1: Listo para jugar')).toBeTruthy();
    // El jugador actual se marca con texto, no sólo con color.
    expect(screen.getAllByText('(vos)').length).toBeGreaterThan(0);
  });

  it('explica que el cuadro se arma al arrancar cuando todavía no hay cruces', () => {
    render(<TournamentBracket matches={[]} format="SINGLE_ELIMINATION" currentUserId={null} />);
    expect(screen.getByText(/El cuadro se arma cuando arranca el torneo/)).toBeTruthy();
  });
});

describe('detalle del torneo', () => {
  function detail(overrides: Partial<TournamentDetailResponse> = {}): TournamentDetailResponse {
    return {
      tournament: SUMMARY,
      participants: [
        {
          userId: USER_ID,
          nickname: 'TanaDelSur',
          seed: 1,
          status: 'CHECKED_IN',
          registeredAt: '2026-11-26T12:00:00.000Z',
          checkedInAt: '2026-11-26T12:35:00.000Z',
          rating: 1820,
        },
      ],
      matches: [match()],
      standings: [
        {
          position: 1,
          userId: USER_ID,
          nickname: 'TanaDelSur',
          seed: 1,
          eliminationRound: null,
          tiebreakNote: 'Campeón',
        },
      ],
      myNextMatch: match({ roomId: '019a7e40-0000-7000-8000-0000000000r1' }),
      canRegister: false,
      canCheckIn: false,
      registrationClosedReason: null,
      ...overrides,
    };
  }

  it('muestra la próxima partida y permite entrar a la mesa', async () => {
    api.getTournamentDetailRequest.mockResolvedValue(detail());
    const onNavigate = vi.fn();
    render(
      <TournamentDetailScreen
        tournamentId={SUMMARY.id}
        currentUserId={USER_ID}
        onNavigate={onNavigate}
      />,
    );

    expect(await screen.findByText('Mi próxima partida')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la mesa' }));
    expect(onNavigate).toHaveBeenCalledWith('/mesa/019a7e40-0000-7000-8000-0000000000r1');
  });

  it('inscribe y recarga el detalle', async () => {
    api.getTournamentDetailRequest.mockResolvedValue(detail({ canRegister: true }));
    api.registerForTournamentRequest.mockResolvedValue({ participants: 3 });
    render(
      <TournamentDetailScreen
        tournamentId={SUMMARY.id}
        currentUserId={USER_ID}
        onNavigate={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Inscribirme' }));
    await waitFor(() => expect(api.registerForTournamentRequest).toHaveBeenCalledWith(SUMMARY.id));
    expect((await screen.findByRole('status')).textContent).toContain('Quedaste inscripto');
  });

  it('traduce el motivo real del rechazo en vez de un error genérico', async () => {
    api.getTournamentDetailRequest.mockResolvedValue(detail({ canRegister: true }));
    api.registerForTournamentRequest.mockRejectedValue({
      details: { reason: 'TOURNAMENT_FULL' },
    });
    render(
      <TournamentDetailScreen
        tournamentId={SUMMARY.id}
        currentUserId={USER_ID}
        onNavigate={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Inscribirme' }));
    expect((await screen.findByRole('alert')).textContent).toContain('El torneo se completó');
  });

  it('explica por qué no se puede inscribir cuando el cupo está lleno', async () => {
    api.getTournamentDetailRequest.mockResolvedValue(
      detail({ registrationClosedReason: 'El torneo está completo.' }),
    );
    render(
      <TournamentDetailScreen
        tournamentId={SUMMARY.id}
        currentUserId={USER_ID}
        onNavigate={vi.fn()}
      />,
    );
    expect(await screen.findByText('El torneo está completo.')).toBeTruthy();
  });

  it('aclara que los premios son simbólicos y muestra el código sólo a quien organiza', async () => {
    api.getTournamentDetailRequest.mockResolvedValue(detail());
    render(
      <TournamentDetailScreen
        tournamentId={SUMMARY.id}
        currentUserId={USER_ID}
        onNavigate={vi.fn()}
      />,
    );
    expect((await screen.findAllByText(/sin valor económico/)).length).toBeGreaterThan(0);
    expect(screen.getByText('ABC234')).toBeTruthy();
  });
});
