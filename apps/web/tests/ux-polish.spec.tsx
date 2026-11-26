import type { AuthUserSummary, MatchmakingQueueStatusResponse } from '@truco/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/components/AppShell.js';
import { HomeScreen } from '../src/features/home/HomeScreen.js';
import { LobbyScreen } from '../src/features/lobby/LobbyScreen.js';
import {
  isHumanSearchActive,
  secondsSearching,
  secondsUntilPracticeOffered,
  shouldOfferPractice,
} from '../src/features/practice/search-fallback.js';
import { DEFAULT_PRACTICE_FALLBACK_SECONDS } from '../src/lib/ux-config.js';

const api = vi.hoisted(() => ({
  cancelMatchmakingRequest: vi.fn(),
  createTableRequest: vi.fn(),
  enqueueMatchmakingRequest: vi.fn(),
  ensureGuestOrActiveSession: vi.fn(),
  getMatchmakingQueueStatusRequest: vi.fn(),
  joinPublicTableRequest: vi.fn(),
  joinTableByCodeRequest: vi.fn(),
  listPublicTablesRequest: vi.fn(),
  mintSingleUseWsTicket: vi.fn(),
}));

const socket = vi.hoisted(() => ({
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  io: { on: vi.fn() },
}));

vi.mock('../src/lib/api-client.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...api,
}));

vi.mock('socket.io-client', () => ({ io: () => socket }));

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  api.listPublicTablesRequest.mockResolvedValue({ tables: [] });
  api.getMatchmakingQueueStatusRequest.mockResolvedValue({ status: 'IDLE' });
  api.ensureGuestOrActiveSession.mockResolvedValue(CURRENT_USER);
});

const CURRENT_USER: AuthUserSummary = {
  id: '019a7e40-0000-7000-8000-0000000000a1',
  email: null,
  emailVerified: false,
  nickname: 'TanaDelSur',
  isGuest: true,
  role: 'PLAYER',
  status: 'ACTIVE',
  createdAt: '2026-11-18T12:00:00.000Z',
};

const QUEUED: MatchmakingQueueStatusResponse = {
  status: 'QUEUED',
  mode: '1v1',
  rulesetCode: 'ar-standard-v1',
  competitive: false,
  position: 1,
  enqueuedAt: new Date(Date.now() - 45_000).toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

describe('Tanda UX — espera por rival humano y ofrecimiento de práctica', () => {
  it('no ofrece práctica antes del umbral configurado', () => {
    const now = Date.parse('2026-11-19T12:00:00.000Z');
    const queue = {
      ...QUEUED,
      enqueuedAt: new Date(now - 10_000).toISOString(),
    } as const;
    expect(isHumanSearchActive(QUEUED)).toBe(true);
    expect(secondsSearching(queue, now)).toBe(10);
    expect(shouldOfferPractice(queue, now, DEFAULT_PRACTICE_FALLBACK_SECONDS)).toBe(false);
    expect(secondsUntilPracticeOffered(queue, now, 30)).toBe(20);
  });

  it('ofrece práctica apenas se alcanza el umbral y con una marca de entrada inválida no adelanta', () => {
    const now = Date.parse('2026-11-19T12:00:00.000Z');
    const atThreshold = {
      ...QUEUED,
      enqueuedAt: new Date(now - 30_000).toISOString(),
    } as const;
    expect(shouldOfferPractice(atThreshold, now, 30)).toBe(true);
    expect(secondsUntilPracticeOffered(atThreshold, now, 30)).toBe(0);

    const invalid = { ...QUEUED, enqueuedAt: 'no-es-una-fecha' } as const;
    expect(secondsSearching(invalid, now)).toBe(0);
    expect(shouldOfferPractice(invalid, now, 30)).toBe(false);
  });

  it('no ofrece práctica cuando la cola está inactiva', () => {
    expect(shouldOfferPractice({ status: 'IDLE' }, Date.now(), 30)).toBe(false);
  });

  it('en Inicio el paso principal es Jugar ahora y la práctica queda después', () => {
    render(
      <HomeScreen
        currentUser={CURRENT_USER}
        sessionLoading={false}
        onSessionChanged={() => undefined}
        onNavigate={() => undefined}
      />,
    );

    const playNow = screen.getByRole('button', { name: /Jugar ahora · buscar rival 1 vs 1/i });
    const practiceHeading = screen.getByRole('heading', { name: /Jugar contra la máquina/i });
    expect(playNow).toBeTruthy();
    // Orden del DOM: la acción principal precede a la práctica.
    expect(
      playNow.compareDocumentPosition(practiceHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      playNow.compareDocumentPosition(practiceHeading) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBe(0);
  });

  it('muestra el aviso de espera con la cuenta regresiva y la salida de práctica al quedar en cola', async () => {
    api.enqueueMatchmakingRequest.mockResolvedValue({
      ...QUEUED,
      enqueuedAt: new Date(Date.now() - 45_000).toISOString(),
    });
    let scrolledTo: string | null = null;
    const scrollIntoView = vi.fn(function (this: HTMLElement) {
      scrolledTo = this.id;
    });
    Element.prototype.scrollIntoView = scrollIntoView;

    render(
      <HomeScreen
        currentUser={CURRENT_USER}
        sessionLoading={false}
        onSessionChanged={() => undefined}
        onNavigate={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Jugar ahora · buscar rival 1 vs 1/i }));

    const offer = await screen.findByRole('button', {
      name: /Practicar contra la máquina mientras espero/i,
    });
    expect(screen.getByText(/Seguimos buscando/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cancelar búsqueda/i })).toBeTruthy();

    fireEvent.click(offer);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrolledTo).toBe('machine-heading');
  });

  it('en el lobby las mesas con humanos van antes que crear mesa y la práctica queda aparte', async () => {
    api.listPublicTablesRequest.mockResolvedValue({
      tables: [
        {
          id: '019a7e40-0000-7000-8000-0000000007f1',
          roomId: '019a7e40-0000-7000-8000-0000000007f1',
          mode: '1v1',
          rulesetCode: 'ar-standard-v1',
          visibility: 'PUBLIC',
          status: 'WAITING',
          targetScore: 30,
          flor: true,
          occupiedSeats: 1,
          maxSeats: 2,
          ownerNickname: 'Tano del Paño',
          isPractice: false,
          createdAt: '2026-11-19T12:00:00.000Z',
        },
      ],
    });

    render(
      <LobbyScreen
        currentUser={CURRENT_USER}
        onSessionChanged={() => undefined}
        onNavigate={() => undefined}
      />,
    );

    const tablesHeading = await screen.findByRole('heading', { name: 'Mesas con personas' });
    const queueHeading = screen.getByRole('heading', { name: /Cola de partida rápida/i });
    const createHeading = screen.getByRole('heading', { name: /Armar nueva mesa/i });
    const practiceHeading = screen.getByRole('heading', { name: /^Practicar contra la máquina$/i });

    const precedes = (first: HTMLElement, second: HTMLElement) =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(precedes(queueHeading, createHeading)).toBe(true);
    expect(precedes(tablesHeading, createHeading)).toBe(true);
    expect(precedes(createHeading, practiceHeading)).toBe(true);

    const tableItem = await screen.findByText(/Tano del Paño/);
    expect(tableItem).toBeTruthy();
    expect(screen.getByText(/3 mesa|1 mesa\(s\) abierta\(s\) con humanos/i)).toBeTruthy();
  });

  it('el encabezado conserva todos los destinos y el control de sonido con nombre accesible', () => {
    render(
      <AppShell activeSection="home" currentUser={CURRENT_USER} onNavigate={() => undefined}>
        <p>Contenido</p>
      </AppShell>,
    );

    const desktopNav = screen.getAllByRole('navigation', { name: /navegación principal/i })[0]!;
    const destinations = within(desktopNav).getAllByRole('button');
    expect(destinations.map((item) => item.textContent)).toEqual([
      'Inicio',
      'Lobby en vivo',
      'Rankings',
      'Aprender',
      'Anotador',
      'Amigos',
      'Progreso',
      'Perfil',
    ]);
    expect(screen.getByRole('button', { name: /Sonido activo/i })).toBeTruthy();
  });
});
