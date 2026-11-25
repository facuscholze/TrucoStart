import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchResultModal } from '../src/features/mesa/MatchResultModal.js';
import { ReportButton } from '../src/features/moderation/ReportButton.js';
import { ReportDialog } from '../src/features/moderation/ReportDialog.js';
import { WebApiError } from '../src/lib/api-client.js';

const createReportRequest = vi.fn();

vi.mock('../src/lib/api-client.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/lib/api-client.js');
  return {
    ...actual,
    createReportRequest: (...args: unknown[]) => createReportRequest(...args),
  };
});

const TARGET = { userId: '019a7e40-0000-7000-8000-0000000000a1', nickname: 'TanoBaston' };
const OTHER = { userId: '019a7e40-0000-7000-8000-0000000000a2', nickname: 'LaViejaEscuela' };
const MATCH_ID = '019a7e40-0000-7000-8000-0000000000d1';

describe('M7 — reportar a otro jugador desde el cliente', () => {
  beforeEach(() => {
    createReportRequest.mockReset();
  });
  afterEach(() => cleanup());

  it('muestra los cinco motivos y adjunta partida al enviar', async () => {
    createReportRequest.mockResolvedValue({
      id: '019a7e40-0000-7000-8000-0000000000b1',
      status: 'OPEN',
      mergedWithExisting: false,
      createdAt: new Date().toISOString(),
      eventLogRef: { matchId: MATCH_ID, eventCount: 42, lastSeq: 42, digest: 'a'.repeat(64) },
    });

    render(<ReportDialog open targets={[TARGET]} matchId={MATCH_ID} onClose={() => undefined} />);

    expect(screen.getByText('Abandono reiterado')).toBeTruthy();
    expect(screen.getByText('Sospecha de colusión o señas fuera del sistema')).toBeTruthy();
    expect(screen.getByText('Apodo ofensivo')).toBeTruthy();
    expect(screen.getByText('Comportamiento abusivo')).toBeTruthy();
    expect(screen.getByText('Otro')).toBeTruthy();

    fireEvent.click(screen.getByText('Comportamiento abusivo'));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }));

    await waitFor(() => expect(createReportRequest).toHaveBeenCalledTimes(1));
    expect(createReportRequest).toHaveBeenCalledWith({
      targetUserId: TARGET.userId,
      reasonCode: 'ABUSIVE_BEHAVIOR',
      matchId: MATCH_ID,
    });

    await waitFor(() => expect(screen.getByTestId('report-success')).toBeTruthy());
    expect(screen.getByText(/42 eventos del registro/)).toBeTruthy();
  });

  it('exige comentario cuando el motivo es "Otro"', () => {
    render(<ReportDialog open targets={[TARGET]} onClose={() => undefined} />);
    fireEvent.click(screen.getByText('Otro'));
    const submit = screen.getByRole('button', { name: 'Enviar reporte' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('permite elegir entre varios rivales y reportar a uno solo', async () => {
    createReportRequest.mockResolvedValue({
      id: '019a7e40-0000-7000-8000-0000000000b2',
      status: 'OPEN',
      mergedWithExisting: true,
      createdAt: new Date().toISOString(),
      eventLogRef: null,
    });

    render(<ReportDialog open targets={[TARGET, OTHER]} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText('Jugador a reportar'), {
      target: { value: OTHER.userId },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }));

    await waitFor(() => expect(createReportRequest).toHaveBeenCalledTimes(1));
    expect(createReportRequest.mock.calls[0]?.[0]).toMatchObject({
      targetUserId: OTHER.userId,
      reasonCode: 'ABUSIVE_BEHAVIOR',
    });
    await waitFor(() => expect(screen.getByTestId('report-success')).toBeTruthy());
  });

  it('traduce el rate limit y el tope de reportes abiertos a un mensaje claro', async () => {
    createReportRequest.mockRejectedValueOnce(new WebApiError(429, 'RATE_LIMITED', 'Too many'));
    render(<ReportDialog open targets={[TARGET]} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('demasiado seguido'),
    );

    createReportRequest.mockRejectedValueOnce(
      new WebApiError(400, 'TOO_MANY_OPEN_REPORTS', 'Límite de reportes abiertos'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enviar reporte' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('reportes abiertos'),
    );
  });

  it('no muestra el botón si no hay humanos a quienes reportar (bots o uno mismo)', () => {
    const { container } = render(<ReportButton targets={[]} myUserId={TARGET.userId} />);
    expect(container.querySelector('button')).toBeNull();

    const selfOnly = render(<ReportButton targets={[TARGET]} myUserId={TARGET.userId} />);
    expect(selfOnly.container.querySelector('button')).toBeNull();
  });

  it('abre el diálogo desde el botón y cierra al cancelar', async () => {
    render(<ReportButton targets={[TARGET]} matchId={MATCH_ID} myUserId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reportar' }));
    await waitFor(() => expect(screen.getByText('Reportar a un jugador')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByText('Reportar a un jugador')).toBeNull());
  });

  it('traduce el motivo real de finalización y ofrece reportar a los rivales humanos', () => {
    const noop = () => undefined;
    render(
      <MatchResultModal
        open
        myTeam={0}
        summary={{
          matchId: MATCH_ID,
          winnerTeam: 0,
          usScore: 15,
          themScore: 11,
          targetScore: 15,
          reason: 'TARGET_SCORE',
          seedCommitment: 'ab'.repeat(32),
          seedReveal: 'cd'.repeat(32),
        }}
        rematchRequested={false}
        reportTargets={[TARGET, OTHER]}
        matchId={MATCH_ID}
        myUserId="019a7e40-0000-7000-8000-0000000000ff"
        onRequestRematch={noop}
        onExitToHome={noop}
      />,
    );
    expect(screen.getByTestId('match-result-report')).toBeTruthy();
    expect(screen.getByText('Partida definida por alcanzar el puntaje objetivo.')).toBeTruthy();
    expect(screen.queryByText('TARGET_SCORE')).toBeNull();
    const reportButtons = screen.getAllByRole('button', { name: 'Reportar' });
    expect(reportButtons.length).toBeGreaterThan(0);
  });

  it('no expone códigos internos cuando recibe un motivo de cierre desconocido', () => {
    render(
      <MatchResultModal
        open
        myTeam={0}
        summary={{
          matchId: MATCH_ID,
          winnerTeam: 0,
          usScore: 15,
          themScore: 11,
          targetScore: 15,
          reason: 'INTERNAL_REASON',
          seedCommitment: 'ab'.repeat(32),
          seedReveal: 'cd'.repeat(32),
        }}
        rematchRequested={false}
        onRequestRematch={() => undefined}
        onExitToHome={() => undefined}
      />,
    );
    expect(screen.getByText('Partida finalizada.')).toBeTruthy();
    expect(screen.queryByText('INTERNAL_REASON')).toBeNull();
  });
});
