import { CallButton } from '@truco/ui';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import { PRACTICE_FALLBACK_SECONDS } from '../../lib/ux-config.js';
import { isHumanSearchActive, secondsSearching } from './search-fallback.js';

export interface PracticeOfferNoticeProps {
  readonly queue: Parameters<typeof isHumanSearchActive>[0];
  readonly nowMs: number;
  /** Arranca una partida de práctica con los valores por defecto del panel. */
  readonly onStartPractice: () => void;
  readonly practiceBusy: boolean;
  readonly thresholdSeconds?: number;
}

/**
 * Aviso que aparece cuando la espera por un rival humano supera el umbral configurado
 * (P1 de `docs/UX_AUDIT_M0-M9C.md`): ofrece practicar contra la máquina sin cancelar la
 * búsqueda. Mientras el jugador no lo pida, la cola sigue viva y el botón de cancelar
 * permanece visible en el bloque de la cola.
 */
export function PracticeOfferNotice({
  queue,
  nowMs,
  onStartPractice,
  practiceBusy,
  thresholdSeconds = PRACTICE_FALLBACK_SECONDS,
}: PracticeOfferNoticeProps) {
  if (!isHumanSearchActive(queue)) return null;
  const waiting = secondsSearching(queue, nowMs) >= thresholdSeconds;
  if (!waiting) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-sky/50 bg-elevated p-3.5 space-y-2.5"
    >
      <div className="space-y-1">
        <p className="text-sm font-bold text-ivory">{messagesEsAr.practiceOffer.title}</p>
        <p className="text-xs leading-relaxed text-muted">{messagesEsAr.practiceOffer.body}</p>
      </div>
      <CallButton
        tone="neutral"
        disabled={practiceBusy}
        onClick={onStartPractice}
        ariaLabel={messagesEsAr.practiceOffer.cta}
      >
        {practiceBusy ? messagesEsAr.practiceOffer.ctaBusy : messagesEsAr.practiceOffer.cta}
      </CallButton>
    </div>
  );
}
