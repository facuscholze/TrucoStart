import {
  REPORT_LIMITS,
  REPORT_REASON_LABELS_ES_AR,
  type CreateReportResponse,
  type ReportReasonCode,
} from '@truco/shared';
import { CallButton, Modal } from '@truco/ui';
import { useState } from 'react';
import { createReportRequest, WebApiError } from '../../lib/api-client.js';

export interface ReportTarget {
  readonly userId: string;
  readonly nickname: string;
}

const REASON_ORDER: readonly ReportReasonCode[] = [
  'ABANDONMENT',
  'COLLUSION',
  'OFFENSIVE_NICKNAME',
  'ABUSIVE_BEHAVIOR',
  'OTHER',
];

const REASON_HINTS: Record<ReportReasonCode, string> = {
  ABANDONMENT: 'Se fue de la partida más de una vez y dejó al equipo colgado.',
  COLLUSION: 'Sospecha de colusión o señas fuera del sistema entre dos jugadores.',
  OFFENSIVE_NICKNAME: 'El apodo del jugador es ofensivo.',
  ABUSIVE_BEHAVIOR: 'Insultos, hostigamiento o provocaciones reiteradas.',
  OTHER: 'Otro motivo: describilo abajo con el mayor detalle posible.',
};

export function errorMessageForReport(error: unknown): string {
  if (error instanceof WebApiError) {
    if (error.status === 429) {
      return `Estás reportando demasiado seguido. Esperá un rato: el límite es ${REPORT_LIMITS.reportsPerWindow} reportes cada ${Math.round(
        REPORT_LIMITS.rateLimitWindowMs / 60_000,
      )} minutos.`;
    }
    if (error.code === 'TOO_MANY_OPEN_REPORTS') {
      return `Ya tenés ${REPORT_LIMITS.maxOpenReportsPerReporter} reportes abiertos. Esperá a que un moderador los resuelva.`;
    }
    if (error.code === 'VALIDATION_ERROR') {
      return 'Revisá el motivo y el comentario (mínimo 10 caracteres en "Otro").';
    }
    if (error.status === 401) {
      return 'Necesitás iniciar sesión para reportar a otro jugador.';
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'No pudimos enviar el reporte.';
}

export function ReportDialog({
  open,
  targets,
  matchId,
  onClose,
}: {
  readonly open: boolean;
  readonly targets: readonly ReportTarget[];
  readonly matchId?: string | null;
  readonly onClose: () => void;
}) {
  const [targetUserId, setTargetUserId] = useState<string>(targets[0]?.userId ?? '');
  const [reasonCode, setReasonCode] = useState<ReportReasonCode>('ABUSIVE_BEHAVIOR');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateReportResponse | null>(null);

  const selectedTarget = targets.find((target) => target.userId === targetUserId) ?? targets[0];
  const detailsRequired = reasonCode === 'OTHER' || reasonCode === 'COLLUSION';
  const detailsTooShort = detailsRequired && details.trim().length < 10;

  const close = () => {
    setResult(null);
    setError(null);
    setDetails('');
    onClose();
  };

  const submit = async () => {
    if (!selectedTarget) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createReportRequest({
        targetUserId: selectedTarget.userId,
        reasonCode,
        ...(details.trim().length > 0 ? { details: details.trim() } : {}),
        ...(matchId ? { matchId } : {}),
      });
      setResult(created);
    } catch (submitError) {
      setError(errorMessageForReport(submitError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={result ? 'Reporte enviado' : 'Reportar a un jugador'}
      footer={
        result ? (
          <CallButton tone="neutral" onClick={close}>
            Cerrar
          </CallButton>
        ) : (
          <>
            <CallButton tone="neutral" onClick={close} disabled={busy}>
              Cancelar
            </CallButton>
            <CallButton
              tone="accept"
              onClick={() => void submit()}
              disabled={busy || !selectedTarget || detailsTooShort}
            >
              {busy ? 'Enviando…' : 'Enviar reporte'}
            </CallButton>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-2 text-sm text-ivory/85" data-testid="report-success">
          <p>
            Gracias por avisar. Un moderador va a revisar el caso
            {result.mergedWithExisting
              ? ' junto con los reportes que ya teníamos de este jugador.'
              : '.'}
          </p>
          <p className="text-xs text-ivory/60">
            Número de caso: <span className="font-mono">{result.id.slice(0, 8)}</span>
          </p>
          {result.eventLogRef && (
            <p className="text-xs text-ivory/60">
              Adjuntamos la partida y {result.eventLogRef.eventCount} eventos del registro para que
              el equipo pueda revisarlos.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-ivory/75">
            El reporte se envía al equipo de moderación con la partida y el registro de eventos
            adjuntos automáticamente. Los reportes falsos reiterados también se sancionan.
          </p>

          {targets.length > 1 && (
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-ivory/60">
                Jugador
              </span>
              <select
                aria-label="Jugador a reportar"
                className="w-full rounded-lg border border-ivory/20 bg-surface/70 px-3 py-2 text-sm"
                value={targetUserId}
                onChange={(event) => setTargetUserId(event.target.value)}
              >
                {targets.map((target) => (
                  <option key={target.userId} value={target.userId}>
                    {target.nickname}
                  </option>
                ))}
              </select>
            </label>
          )}

          <fieldset className="space-y-1">
            <legend className="text-xs font-semibold uppercase tracking-wide text-ivory/60">
              Motivo
            </legend>
            {REASON_ORDER.map((reason) => (
              <label
                key={reason}
                className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 hover:bg-ivory/5"
              >
                <input
                  type="radio"
                  name="report-reason"
                  value={reason}
                  checked={reasonCode === reason}
                  onChange={() => setReasonCode(reason)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-ivory">{REPORT_REASON_LABELS_ES_AR[reason]}</span>
                  <span className="block text-[11px] text-ivory/55">{REASON_HINTS[reason]}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-ivory/60">
              Comentario {detailsRequired ? '(obligatorio)' : '(opcional)'}
            </span>
            <textarea
              className="min-h-[80px] w-full rounded-lg border border-ivory/20 bg-surface/70 px-3 py-2 text-sm"
              maxLength={500}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="Contanos qué pasó, en qué mano y con quién."
            />
          </label>

          {matchId && (
            <p className="text-[11px] text-ivory/50">
              Partida adjunta: <span className="font-mono">{matchId.slice(0, 8)}…</span>
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
