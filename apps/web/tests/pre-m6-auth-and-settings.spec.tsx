import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthScreen } from '../src/features/auth/AuthScreen.js';
import { ProfileScreen } from '../src/features/profile/ProfileScreen.js';
import type { AuthUserSummary } from '@truco/shared';
import { loadClientPreferences } from '../src/lib/preferences.js';

const registerAccountRequest = vi.fn();
const promoteGuestAccountRequest = vi.fn();
const loginAccountRequest = vi.fn();
const forgotPasswordRequest = vi.fn();
const resetPasswordRequest = vi.fn();
const verifyEmailRequest = vi.fn();
const resendVerificationEmailRequest = vi.fn();
const listActiveSessionsRequest = vi.fn();
const revokeActiveSessionRequest = vi.fn();
const logoutSessionRequest = vi.fn();
const patchMeRequest = vi.fn();
const exportAccountDataRequest = vi.fn();
const deleteOwnAccountRequest = vi.fn();
const getMeRequest = vi.fn();
const getUserStatsRequest = vi.fn();
const getUserMatchesRequest = vi.fn();
const ensureGuestOrActiveSession = vi.fn();

vi.mock('../src/lib/api-client.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/lib/api-client.js');
  return {
    ...actual,
    registerAccountRequest: (...args: unknown[]) => registerAccountRequest(...args),
    promoteGuestAccountRequest: (...args: unknown[]) => promoteGuestAccountRequest(...args),
    loginAccountRequest: (...args: unknown[]) => loginAccountRequest(...args),
    forgotPasswordRequest: (...args: unknown[]) => forgotPasswordRequest(...args),
    resetPasswordRequest: (...args: unknown[]) => resetPasswordRequest(...args),
    verifyEmailRequest: (...args: unknown[]) => verifyEmailRequest(...args),
    resendVerificationEmailRequest: (...args: unknown[]) => resendVerificationEmailRequest(...args),
    listActiveSessionsRequest: (...args: unknown[]) => listActiveSessionsRequest(...args),
    revokeActiveSessionRequest: (...args: unknown[]) => revokeActiveSessionRequest(...args),
    logoutSessionRequest: (...args: unknown[]) => logoutSessionRequest(...args),
    patchMeRequest: (...args: unknown[]) => patchMeRequest(...args),
    exportAccountDataRequest: (...args: unknown[]) => exportAccountDataRequest(...args),
    deleteOwnAccountRequest: (...args: unknown[]) => deleteOwnAccountRequest(...args),
    getMeRequest: (...args: unknown[]) => getMeRequest(...args),
    getUserStatsRequest: (...args: unknown[]) => getUserStatsRequest(...args),
    getUserMatchesRequest: (...args: unknown[]) => getUserMatchesRequest(...args),
    ensureGuestOrActiveSession: (...args: unknown[]) => ensureGuestOrActiveSession(...args),
  };
});

const registeredUser: AuthUserSummary = {
  id: 'usr-1',
  email: 'gaucho@truco.ar',
  nickname: 'GauchoDelSur',
  isGuest: false,
  emailVerified: true,
  role: 'PLAYER',
  status: 'ACTIVE',
  createdAt: '2026-11-01T10:00:00.000Z',
};

const guestUser: AuthUserSummary = {
  ...registeredUser,
  id: 'usr-guest',
  email: null,
  nickname: 'Invitado_1234',
  isGuest: true,
  emailVerified: false,
};

function mockProfileLoads() {
  getMeRequest.mockResolvedValue({
    user: registeredUser,
    profile: {
      bio: 'Juego de mano',
      avatarId: 'gaucho',
      level: 1,
      xp: 0,
      settings: {
        soundEnabled: true,
        animationsReduced: false,
        confirmCalls: false,
        historyVisibility: 'FRIENDS',
        statsVisibility: 'FRIENDS',
        presenceVisibility: 'FRIENDS',
      },
    },
  });
  getUserStatsRequest.mockResolvedValue({
    userId: registeredUser.id,
    matchesPlayed: 4,
    wins: 3,
    losses: 1,
    abandons: 0,
    winRate: 0.75,
    byMode: {
      '1v1': {
        matchesPlayed: 4,
        wins: 3,
        losses: 1,
        abandons: 0,
        winRate: 0.75,
        currentStreak: 2,
        envido: { resolved: 1, won: 1, winRate: 1 },
        truco: { resolved: 2, won: 1, winRate: 0.5 },
      },
      '2v2': {
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        abandons: 0,
        winRate: 0,
        currentStreak: 0,
        envido: { resolved: 0, won: 0, winRate: 0 },
        truco: { resolved: 0, won: 0, winRate: 0 },
      },
    },
  });
  getUserMatchesRequest.mockResolvedValue({ items: [], nextCursor: null });
  listActiveSessionsRequest.mockResolvedValue({
    sessions: [
      {
        id: 'sess-current',
        deviceName: 'Navegador Web PWA',
        createdAt: '2026-11-02T10:00:00.000Z',
        lastUsedAt: '2026-11-03T10:00:00.000Z',
        isCurrent: true,
      },
      {
        id: 'sess-phone',
        deviceName: 'Teléfono Android',
        createdAt: '2026-11-01T09:00:00.000Z',
        lastUsedAt: '2026-11-02T09:00:00.000Z',
        isCurrent: false,
      },
    ],
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  mockProfileLoads();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Pre-M6 — alta de cuenta (registro) y promoción de invitado', () => {
  /**
   * M8d: el alta exige consentimiento explícito y edad declarada. Este helper
   * completa ese paso para que los tests de flujo se concentren en lo suyo.
   */
  function acceptLegalStep(age: number) {
    fireEvent.change(screen.getByLabelText(/Declaro tener/i), { target: { value: String(age) } });
    fireEvent.click(screen.getByLabelText(/acepto los Términos/i));
  }

  it('registra una cuenta nueva con email, apodo y clave, y publica la sesión resultante', async () => {
    registerAccountRequest.mockResolvedValue({ user: registeredUser, session: {} });
    const onSessionChanged = vi.fn();
    const onNavigate = vi.fn();

    render(
      <AuthScreen
        currentUser={null}
        onSessionChanged={onSessionChanged}
        onNavigate={onNavigate}
        initialTab="register"
      />,
    );

    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), {
      target: { value: 'gaucho@truco.ar' },
    });
    fireEvent.change(screen.getByLabelText(/Apodo en la mesa/i), {
      target: { value: 'GauchoDelSur' },
    });
    fireEvent.change(screen.getByLabelText(/Contraseña/i), {
      target: { value: 'TrucoDev2026!' },
    });
    acceptLegalStep(30);
    fireEvent.click(screen.getByRole('button', { name: /Crear cuenta y entrar/i }));

    await waitFor(() => {
      expect(registerAccountRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'gaucho@truco.ar',
          password: 'TrucoDev2026!',
          nickname: 'GauchoDelSur',
          legal: expect.objectContaining({ accepted: true, age: 30 }),
        }),
      );
    });
    expect(onSessionChanged).toHaveBeenCalledWith(registeredUser);
    expect(onNavigate).toHaveBeenCalledWith('/perfil');
  });

  it('promueve la cuenta invitada conservando el id y muestra el error de validación del servidor', async () => {
    promoteGuestAccountRequest.mockResolvedValueOnce({ user: registeredUser, session: {} });
    const onSessionChanged = vi.fn();

    const { unmount } = render(
      <AuthScreen
        currentUser={guestUser}
        onSessionChanged={onSessionChanged}
        onNavigate={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), {
      target: { value: 'invitado@truco.ar' },
    });
    fireEvent.change(screen.getByLabelText(/Contraseña/i), {
      target: { value: 'TrucoDev2026!' },
    });
    acceptLegalStep(25);
    fireEvent.click(screen.getByRole('button', { name: /Vincular correo/i }));
    await waitFor(() => expect(onSessionChanged).toHaveBeenCalledWith(registeredUser));
    unmount();

    promoteGuestAccountRequest.mockRejectedValueOnce(
      new Error('Ya existe una cuenta con ese correo electrónico.'),
    );
    render(
      <AuthScreen
        currentUser={guestUser}
        onSessionChanged={onSessionChanged}
        onNavigate={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), {
      target: { value: 'repetido@truco.ar' },
    });
    fireEvent.change(screen.getByLabelText(/Contraseña/i), {
      target: { value: 'TrucoDev2026!' },
    });
    acceptLegalStep(25);
    fireEvent.click(screen.getByRole('button', { name: /Vincular correo/i }));
    expect(await screen.findByText(/Ya existe una cuenta con ese correo/i)).toBeTruthy();
  });
});

describe('Pre-M6 — recuperación de contraseña y verificación de correo', () => {
  it('pide el enlace de recuperación y muestra el mensaje anti-enumeración', async () => {
    forgotPasswordRequest.mockResolvedValue({ acknowledged: true });

    render(
      <AuthScreen
        currentUser={null}
        onSessionChanged={() => undefined}
        onNavigate={() => undefined}
        initialTab="recover"
      />,
    );

    fireEvent.change(screen.getByLabelText(/Correo electrónico/i), {
      target: { value: 'olvide@truco.ar' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Enviar enlace de recuperación/i }));

    await waitFor(() =>
      expect(forgotPasswordRequest).toHaveBeenCalledWith({ email: 'olvide@truco.ar' }),
    );
    expect(await screen.findByText(/Si el correo corresponde a una cuenta activa/i)).toBeTruthy();
  });

  it('restablece la contraseña usando el token del correo y vuelve al modo login', async () => {
    resetPasswordRequest.mockResolvedValue({ acknowledged: true });

    render(
      <AuthScreen
        currentUser={null}
        onSessionChanged={() => undefined}
        onNavigate={() => undefined}
        initialTab="recover"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Ya tengo un token de recuperación/i }));
    fireEvent.change(screen.getByLabelText(/Código o token de recuperación/i), {
      target: { value: 'token-de-recuperacion-1234567890' },
    });
    fireEvent.change(screen.getByLabelText(/Nueva contraseña/i), {
      target: { value: 'NuevaClave2026!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Actualizar contraseña/i }));

    await waitFor(() =>
      expect(resetPasswordRequest).toHaveBeenCalledWith({
        token: 'token-de-recuperacion-1234567890',
        newPassword: 'NuevaClave2026!',
      }),
    );
    expect(await screen.findByText(/Actualizamos tu contraseña/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Entrar a mi cuenta/i })).toBeTruthy();
  });
});

describe('Pre-M6 — ajustes del perfil (sonido, animaciones, sesiones, exportar y eliminar)', () => {
  it('persiste sonido y animaciones en preferencias y sincroniza los ajustes con la API', async () => {
    patchMeRequest.mockResolvedValue({
      user: registeredUser,
      profile: { bio: '', avatarSeed: 'gaucho', settings: {} },
    });

    render(
      <ProfileScreen
        currentUser={registeredUser}
        onSessionChanged={() => undefined}
        onNavigate={() => undefined}
      />,
    );

    const soundToggle = await screen.findByRole('switch', {
      name: /Efectos de sonido en mesa/i,
    });
    fireEvent.click(soundToggle);
    await waitFor(() => expect(loadClientPreferences().soundEnabled).toBe(false));
    expect(patchMeRequest).toHaveBeenCalledWith({ settings: expect.any(Object) });

    const motionToggle = screen.getByRole('switch', { name: /Reducir animaciones/i });
    fireEvent.click(motionToggle);
    await waitFor(() => expect(loadClientPreferences().animationsReduced).toBe(true));
  });

  it('lista dispositivos activos, revoca una sesión concreta y cierra sesión en todos los dispositivos', async () => {
    revokeActiveSessionRequest.mockResolvedValue({ revoked: true });
    logoutSessionRequest.mockResolvedValue({ acknowledged: true });
    const onSessionChanged = vi.fn();
    const onNavigate = vi.fn();

    render(
      <ProfileScreen
        currentUser={registeredUser}
        onSessionChanged={onSessionChanged}
        onNavigate={onNavigate}
      />,
    );

    expect(await screen.findByText('Teléfono Android')).toBeTruthy();
    expect(screen.getByText('Este dispositivo')).toBeTruthy();

    const phoneRow = screen.getByText('Teléfono Android').closest('li');
    expect(phoneRow).not.toBeNull();
    fireEvent.click(
      within(phoneRow as HTMLElement).getByRole('button', { name: /Cerrar sesión/i }),
    );
    await waitFor(() => expect(revokeActiveSessionRequest).toHaveBeenCalledWith('sess-phone'));
    await waitFor(() => expect(screen.queryByText('Teléfono Android')).toBeNull());

    fireEvent.click(
      screen.getByRole('button', { name: /Cerrar sesión en todos los dispositivos/i }),
    );
    await waitFor(() => expect(logoutSessionRequest).toHaveBeenCalledWith(true));
    expect(onSessionChanged).toHaveBeenCalledWith(null);
    expect(onNavigate).toHaveBeenCalledWith('/acceso');
  });

  it('exporta la copia JSON descargable y elimina la cuenta confirmando el modal', async () => {
    exportAccountDataRequest.mockResolvedValue({
      user: { id: 'usr-1', nickname: 'GauchoDelSur' },
      profile: {},
      stats: {},
      matches: [],
    });
    deleteOwnAccountRequest.mockResolvedValue({ deleted: true });
    const createObjectURL = vi.fn(() => 'blob:export');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const onSessionChanged = vi.fn();
    const onNavigate = vi.fn();

    render(
      <ProfileScreen
        currentUser={registeredUser}
        onSessionChanged={onSessionChanged}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Exportar mis datos \(\.json\)/i }));
    await waitFor(() => expect(exportAccountDataRequest).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Eliminar mi cuenta permanentemente/i }));
    expect(await screen.findByText(/¿Seguro que querés eliminar tu cuenta\?/i)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Confirmá tu contraseña/i), {
      target: { value: 'TrucoDev2026!' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Sí, eliminar mi cuenta/i }));
    });

    await waitFor(() => expect(deleteOwnAccountRequest).toHaveBeenCalledWith('TrucoDev2026!'));
    expect(onSessionChanged).toHaveBeenCalledWith(null);
    expect(onNavigate).toHaveBeenCalledWith('/');
  });
});
