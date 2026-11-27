import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchResultModal } from '../src/features/mesa/MatchResultModal.js';

afterEach(() => cleanup());

/**
 * M10b — el cartel de fin de partida con tres equipos. En el truco de 6 hay dos rivales: el
 * resumen no puede decir "Nosotros 15 · Ellos 0" porque el segundo equipo que aparece en el
 * mapa puede no ser el rival real ni el que se llevó la partida.
 */
describe('M10b MatchResultModal — resultado de la mesa de seis', () => {
  const renderModal = (props: Partial<Parameters<typeof MatchResultModal>[0]> = {}) =>
    render(
      <MatchResultModal
        open={true}
        myTeam={0}
        summary={{
          matchId: '019a7e40-0000-7000-8000-000000de9999',
          winnerTeam: 2,
          usScore: 11,
          themScore: 15,
          teamScores: { '0': 11, '1': 9, '2': 15 },
          myTeam: 0,
          targetScore: 15,
          reason: 'TARGET_SCORE_REACHED',
          seedCommitment: 'a'.repeat(64),
          seedReveal: 'b'.repeat(64),
        }}
        rematchRequested={false}
        onRequestRematch={vi.fn()}
        onExitToHome={vi.fn()}
        {...props}
      />,
    );

  it('muestra el tanteador de los tres equipos y no un duelo', () => {
    renderModal();
    // Nosotros somos el equipo 0 y ganó el equipo 2 "Ellos 3".
    expect(screen.getByText(/Nosotros 11 · Ellos 2 9 · Ellos 3 15/)).toBeTruthy();
    expect(screen.queryByText(/Resultado final a 15: Nosotros 11 · Ellos 15/)).toBeNull();
  });

  it('el título avisa que perdimos cuando ganó otro equipo de la mesa', () => {
    renderModal();
    expect(screen.getByText(/Se nos escapó esta vuelta/)).toBeTruthy();
  });

  it('mantiene el cartel clásico cuando la mesa tiene dos equipos', () => {
    renderModal({
      myTeam: 0,
      summary: {
        matchId: '019a7e40-0000-7000-8000-000000de9998',
        winnerTeam: 0,
        usScore: 15,
        themScore: 12,
        targetScore: 15,
        reason: 'TARGET_SCORE_REACHED',
        seedCommitment: 'a'.repeat(64),
        seedReveal: 'b'.repeat(64),
      },
    });
    expect(screen.getByText(/Resultado final a 15: Nosotros 15 · Ellos 12/)).toBeTruthy();
  });
});
