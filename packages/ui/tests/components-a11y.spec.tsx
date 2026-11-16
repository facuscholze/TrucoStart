import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Avatar,
  Badge,
  CallButton,
  Card,
  Hand,
  Modal,
  PlayerSeat,
  QuickChat,
  RankRow,
  ScoreBoard,
  Table,
  Toast,
} from '../src/index.js';

afterEach(() => cleanup());

describe('@truco/ui components — ARIA roles, keyboard navigation, >=44px targets & prefers-reduced-motion', () => {
  it('renders interactive Card and Hand with keyboard ArrowLeft/ArrowRight navigation and reduced-motion support', async () => {
    const user = userEvent.setup();
    const played: string[] = [];

    render(
      <Hand
        reducedMotion={true}
        onPlayCard={(id) => played.push(id)}
        cards={[
          { id: '1-espadas', rank: 1, suit: 'espadas', playable: true },
          { id: '7-oros', rank: 7, suit: 'oros', playable: true },
          { id: '4-copas', rank: 4, suit: 'copas', playable: false },
        ]}
      />,
    );

    const group = screen.getByRole('group', { name: 'Tu mano de cartas' });
    expect(group).toBeTruthy();

    const anchoBtn = screen.getByRole('button', { name: /Ancho de espadas/i });
    const sieteBtn = screen.getByRole('button', { name: /Siete de oros/i });
    const cuatroBtn = screen.getByRole('button', { name: /Cuatro de copas/i });

    expect((cuatroBtn as HTMLButtonElement).disabled).toBe(true);
    expect(anchoBtn.style.minHeight).toBe('44px');
    expect(anchoBtn.style.transition).toBe('none');

    anchoBtn.focus();
    expect(document.activeElement).toBe(anchoBtn);

    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(sieteBtn);

    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(anchoBtn);

    await user.keyboard('{Enter}');
    expect(played).toEqual(['1-espadas']);
  });

  it('renders face-down static Card, Avatar, Badge, PlayerSeat, ScoreBoard, Table & RankRow with accessible labels', () => {
    render(
      <div>
        <Card faceDown size="sm" />
        <Badge variant="gold">Mano</Badge>
        <Avatar nickname="Facu Cordoba" team={0} connected={true} />
        <ScoreBoard usScore={18} themScore={12} targetScore={30} />
        <ScoreBoard usScore={7} themScore={14} targetScore={15} compact />
        <PlayerSeat
          seat={0}
          nickname="LuciaDelSur"
          team={1}
          isMano={true}
          isActiveTurn={true}
          connected={false}
          remainingCards={2}
          turnRemainingSeconds={9}
          isTurnWarning={true}
          speechBubbleText="¡Envido!"
        />
        <Table
          rounds={[
            {
              roundIndex: 0,
              label: '1.ª baza',
              statusLabel: 'Ganada',
              plays: [{ seat: 0, playerNickname: 'Facu', team: 0, rank: 1, suit: 'bastos' }],
            },
          ]}
          bottomArea={<div>Área inferior</div>}
          sidePanel={<div>Lateral</div>}
        />
        <div role="list">
          <RankRow position={1} nickname="FacuCordoba" metricLabel="Victorias" metricValue={42} />
        </div>
      </div>,
    );

    expect(screen.getByRole('img', { name: 'Carta cubierta' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Facu Cordoba conectado' })).toBeTruthy();
    expect(screen.getByLabelText(/3 buenas/i)).toBeTruthy();
    expect(screen.getByLabelText(/12 malas/i)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Asiento de LuciaDelSur' })).toBeTruthy();
    expect(screen.getByText('¡Envido!')).toBeTruthy();
    expect(screen.getByLabelText('Mesa de truco en vivo')).toBeTruthy();
    expect(screen.getByRole('listitem')).toBeTruthy();
  });

  it('enforces >=44px touch targets and Escape keyboard handling on CallButton, QuickChat, Toast & Modal', async () => {
    const user = userEvent.setup();
    const onCall = vi.fn();
    const onPhrase = vi.fn();
    const onDismiss = vi.fn();
    const onCloseModal = vi.fn();

    render(
      <div>
        <CallButton tone="envido" subtitle="2 pts" onClick={onCall} reducedMotion={true}>
          ¡Envido!
        </CallButton>
        <QuickChat
          phrases={[
            { id: 'buenas', text: '¡Buenas!' },
            { id: 'cantalo', text: '¡Cantalo si te animás!' },
          ]}
          onSelectPhrase={onPhrase}
        />
        <Toast message="Se reconectó el rival" tone="success" onDismiss={onDismiss} />
        <Modal open={true} title="Fin de la partida" onClose={onCloseModal}>
          <p>Ganaste 30 a 24</p>
        </Modal>
      </div>,
    );

    const callBtn = screen.getByRole('button', { name: /¡Envido!/i });
    expect(callBtn.style.minHeight).toBe('44px');
    await user.click(callBtn);
    expect(onCall).toHaveBeenCalledTimes(1);

    const dialog = screen.getByRole('dialog', { name: 'Fin de la partida' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCloseModal).toHaveBeenCalledTimes(1);

    const chatTrigger = screen.getByRole('button', { name: /Frases rápidas/i });
    expect(chatTrigger.style.minHeight).toBe('44px');
    await user.click(chatTrigger);
    const phraseBtn = screen.getByRole('button', { name: '¡Buenas!' });
    await user.click(phraseBtn);
    expect(onPhrase).toHaveBeenCalledWith('buenas');

    const toastRegion = screen.getByRole('status');
    expect(toastRegion.textContent).toContain('Se reconectó el rival');
    await user.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('respects window.matchMedia("(prefers-reduced-motion: reduce)") automatically', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      render(<Card rank={1} suit="espadas" playable selected onPlay={() => undefined} />);
      const btn = screen.getByRole('button', { name: /Ancho de espadas/i });
      expect(btn.style.transition).toBe('none');
      expect(btn.style.transform).toBe('none');
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
