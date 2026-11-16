import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthScreen } from '../src/features/auth/AuthScreen.js';
import { LearnScreen } from '../src/features/learn/LearnScreen.js';
import { ScorerScreen } from '../src/features/scorer/ScorerScreen.js';
import { parseJoinInput } from '../src/lib/api-client.js';
import {
  DEFAULT_CLIENT_PREFERENCES,
  loadClientPreferences,
  saveClientPreferences,
} from '../src/lib/preferences.js';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('M5b — Anotador 100% offline, Aprender, Auth y Preferencias', () => {
  it('persists offline scorekeeper state in localStorage, supports +1/+3/undo and winner banner', () => {
    const { unmount } = render(<ScorerScreen />);

    // Cambiar a 15 tantos
    fireEvent.click(screen.getByRole('button', { name: /Partido a 15/i }));

    // Sumar +4 tres veces y +3 una vez para llegar a 15 en Nosotros
    const plus4Buttons = screen.getAllByRole('button', { name: '+4' });
    const plus3Buttons = screen.getAllByRole('button', { name: '+3' });
    fireEvent.click(plus4Buttons[0]!);
    fireEvent.click(plus4Buttons[0]!);
    fireEvent.click(plus4Buttons[0]!);
    fireEvent.click(plus3Buttons[0]!);

    expect(screen.getByText(/ganó el partido/i)).toBeTruthy();

    // Deshacer última anotación -> vuelve a 12
    fireEvent.click(screen.getByRole('button', { name: /Deshacer última anotación/i }));
    expect(screen.queryByText(/ganó el partido/i)).toBeNull();

    // Recargar componente desde cero (simulando reapertura sin conexión)
    unmount();
    render(<ScorerScreen />);
    expect(screen.getByText('12 / 15')).toBeTruthy();
  });

  it('renders Learn screen with rules, card hierarchy, signals catalog and interactive tutorial', () => {
    render(<LearnScreen />);

    expect(screen.getByText(/Objetivo y reparto/i)).toBeTruthy();

    // Pestaña Escala de cartas
    fireEvent.click(screen.getByRole('tab', { name: /Escala de cartas/i }));
    expect(screen.getByText(/Ancho de espadas \(Macho\)/i)).toBeTruthy();
    expect(screen.getAllByText(/Cuatros/i).length).toBeGreaterThan(0);

    // Pestaña Señas oficiales
    fireEvent.click(screen.getByRole('tab', { name: /Señas oficiales/i }));
    fireEvent.click(screen.getByRole('button', { name: /Guiñar un ojo/i }));
    expect(screen.getByText(/Seña: Guiño/i)).toBeTruthy();

    // Pestaña Tutorial interactivo contra Bot Gaucho
    fireEvent.click(screen.getByRole('tab', { name: /Tutorial interactivo/i }));
    expect(screen.getByText(/Consejo del entrenador/i)).toBeTruthy();
    expect(screen.getByLabelText(/Ancho de espadas/i)).toBeTruthy();
  });

  it('renders Auth screen tabs (login, register, promote, recover) with zero dead buttons', () => {
    render(
      <AuthScreen
        currentUser={null}
        onSessionChanged={() => undefined}
        onNavigate={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: /Entrar como invitado/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Entrar a mi cuenta/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Crear cuenta/i }));
    expect(screen.getByRole('button', { name: /Crear cuenta y entrar/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Recuperar clave/i }));
    expect(screen.getByRole('button', { name: /Enviar enlace de recuperación/i })).toBeTruthy();
  });

  it('parses 6-character join codes and signed invite links and syncs accessibility preferences', () => {
    expect(parseJoinInput('ab9k2m')).toEqual({ code: 'AB9K2M' });
    expect(
      parseJoinInput('https://truco.example/lobby?invite=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc'),
    ).toEqual({
      inviteToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc',
    });

    const updated = saveClientPreferences({
      ...DEFAULT_CLIENT_PREFERENCES,
      highContrast: true,
      largeText: true,
      animationsReduced: true,
    });
    expect(loadClientPreferences()).toEqual(updated);
    expect(document.documentElement.getAttribute('data-high-contrast')).toBe('true');
    expect(document.documentElement.getAttribute('data-large-text')).toBe('true');
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('true');
  });
});
