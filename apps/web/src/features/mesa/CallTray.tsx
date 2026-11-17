import type { WsCallBid, WsCallFamily, WsRespondAnswer } from '@truco/shared';
import { CallButton } from '@truco/ui';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import type { GroupedServerLegalCalls } from './mesa-view-model.js';

export interface CallTrayProps {
  readonly groupedCalls: GroupedServerLegalCalls;
  readonly inlineMode?: boolean;
  readonly onCallBid: (bid: WsCallBid) => void;
  readonly onRespondCall: (family: WsCallFamily, answer: WsRespondAnswer) => void;
  readonly onSendSignal?: (signalId: string) => void;
  readonly onClose?: () => void;
}

export function CallTray({
  groupedCalls,
  inlineMode = false,
  onCallBid,
  onRespondCall,
  onSendSignal,
  onClose,
}: CallTrayProps) {
  const { pendingResponses, envidoBids, trucoBids, florBids, signalIds, totalCallCount } =
    groupedCalls;

  const content = (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-bold text-ivory">
            {inlineMode ? messagesEsAr.mesa.sidePanelCallsTitle : messagesEsAr.calls.trayTitle}
          </h2>
          <p className="text-xs text-muted">{messagesEsAr.calls.traySubtitle}</p>
        </div>
        {!inlineMode && onClose && (
          <button
            type="button"
            aria-label={messagesEsAr.mesa.closeCallTrayCta}
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl bg-surface border border-ivory/20 text-ivory font-bold"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M4 4L12 12M12 4L4 12"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      {totalCallCount === 0 && signalIds.length === 0 ? (
        <p className="text-xs text-muted py-2">{messagesEsAr.calls.noLegalCalls}</p>
      ) : (
        <div className="space-y-3">
          {pendingResponses.length > 0 && (
            <section aria-label={messagesEsAr.calls.groupPendingResponse} className="space-y-1.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gold">
                {messagesEsAr.calls.groupPendingResponse}
              </h3>
              <div className="flex flex-wrap gap-2">
                {pendingResponses.map((resp) => {
                  const copy = messagesEsAr.calls.decisions[resp.decision];
                  const isAccept =
                    resp.decision === 'QUIERO' || resp.decision === 'CON_FLOR_QUIERO';
                  return (
                    <CallButton
                      key={`${resp.family}-${resp.decision}`}
                      tone={isAccept ? 'accept' : 'decline'}
                      subtitle={copy.subtitle}
                      onClick={() => {
                        onRespondCall(resp.family, resp.decision);
                        onClose?.();
                      }}
                    >
                      {copy.label}
                    </CallButton>
                  );
                })}
              </div>
            </section>
          )}

          {envidoBids.length > 0 && (
            <section aria-label={messagesEsAr.calls.groupEnvido} className="space-y-1.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-sky">
                {messagesEsAr.calls.groupEnvido}
              </h3>
              <div className="flex flex-wrap gap-2">
                {envidoBids.map((bid) => {
                  const copy = messagesEsAr.calls.bids[bid];
                  return (
                    <CallButton
                      key={bid}
                      tone="envido"
                      subtitle={copy.subtitle}
                      onClick={() => {
                        onCallBid(bid);
                        onClose?.();
                      }}
                    >
                      {copy.label}
                    </CallButton>
                  );
                })}
              </div>
            </section>
          )}

          {trucoBids.length > 0 && (
            <section aria-label={messagesEsAr.calls.groupTruco} className="space-y-1.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gold">
                {messagesEsAr.calls.groupTruco}
              </h3>
              <div className="flex flex-wrap gap-2">
                {trucoBids.map((bid) => {
                  const copy = messagesEsAr.calls.bids[bid];
                  return (
                    <CallButton
                      key={bid}
                      tone="truco"
                      subtitle={copy.subtitle}
                      onClick={() => {
                        onCallBid(bid);
                        onClose?.();
                      }}
                    >
                      {copy.label}
                    </CallButton>
                  );
                })}
              </div>
            </section>
          )}

          {florBids.length > 0 && (
            <section aria-label={messagesEsAr.calls.groupFlor} className="space-y-1.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-success">
                {messagesEsAr.calls.groupFlor}
              </h3>
              <div className="flex flex-wrap gap-2">
                {florBids.map((bid) => {
                  const copy = messagesEsAr.calls.bids[bid];
                  return (
                    <CallButton
                      key={bid}
                      tone="flor"
                      subtitle={copy.subtitle}
                      onClick={() => {
                        onCallBid(bid);
                        onClose?.();
                      }}
                    >
                      {copy.label}
                    </CallButton>
                  );
                })}
              </div>
            </section>
          )}

          {signalIds.length > 0 && onSendSignal && (
            <section aria-label={messagesEsAr.mesa.signalsSectionTitle} className="space-y-1.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
                {messagesEsAr.mesa.signalsSectionTitle}
              </h3>
              <div className="flex flex-wrap gap-2">
                {signalIds.slice(0, 6).map((sigId) => (
                  <CallButton
                    key={sigId}
                    tone="neutral"
                    onClick={() => {
                      onSendSignal(sigId);
                      onClose?.();
                    }}
                  >
                    {messagesEsAr.calls.signals[sigId] ?? sigId}
                  </CallButton>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );

  if (inlineMode) {
    return (
      <div className="rounded-2xl bg-surface p-4 border border-gold/30 shadow-md">{content}</div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={messagesEsAr.calls.trayTitle}
      className="fixed inset-x-0 bottom-0 z-40 rounded-t-2xl bg-elevated p-4 border-t-2 border-gold shadow-2xl max-h-[78vh] overflow-y-auto"
    >
      <div className="max-w-2xl mx-auto">{content}</div>
    </div>
  );
}
