import { Badge, CallButton, Modal, ScoreBoard } from '@truco/ui';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import { ReportButton } from '../moderation/ReportButton.js';
import type { ReportTarget } from '../moderation/ReportDialog.js';

export interface MatchEndedSummary {
  readonly matchId: string;
  readonly winnerTeam: number;
  readonly usScore: number;
  readonly themScore: number;
  readonly targetScore: number;
  readonly reason: string;
  readonly seedCommitment: string;
  readonly seedReveal: string;
}

export interface MatchResultModalProps {
  readonly open: boolean;
  readonly myTeam: number;
  readonly summary: MatchEndedSummary | null;
  readonly rematchRequested: boolean;
  readonly onRequestRematch: () => void;
  readonly onExitToHome: () => void;
  readonly reportTargets?: readonly ReportTarget[];
  readonly matchId?: string | null;
  readonly myUserId?: string | null;
}

export function MatchResultModal({
  open,
  myTeam,
  summary,
  rematchRequested,
  onRequestRematch,
  onExitToHome,
  reportTargets = [],
  matchId = null,
  myUserId = null,
}: MatchResultModalProps) {
  if (!summary) return null;
  const didWeWin = summary.winnerTeam === myTeam;
  const title = didWeWin ? messagesEsAr.result.modalTitleWin : messagesEsAr.result.modalTitleLoss;
  const reasonText = messagesEsAr.result.reasonLabels[summary.reason] ?? summary.reason;

  return (
    <Modal
      open={open}
      title={title}
      footer={
        <>
          <CallButton tone="neutral" onClick={onExitToHome}>
            {messagesEsAr.result.exitToHomeCta}
          </CallButton>
          <CallButton tone="accept" disabled={rematchRequested} onClick={onRequestRematch}>
            {rematchRequested
              ? messagesEsAr.result.rematchWaitingCta
              : messagesEsAr.result.rematchCta}
          </CallButton>
        </>
      }
    >
      <div className="space-y-4">
        <div
          className="flex items-center justify-between gap-2 flex-wrap"
          data-testid="match-result-header"
        >
          <Badge variant={didWeWin ? 'success' : 'gold'}>
            {messagesEsAr.result.finalScoreSummary(
              summary.usScore,
              summary.themScore,
              summary.targetScore,
            )}
          </Badge>
          <span className="text-xs text-muted">{reasonText}</span>
        </div>

        <ScoreBoard
          usLabel={messagesEsAr.mesa.usLabel}
          themLabel={messagesEsAr.mesa.themLabel}
          usScore={summary.usScore}
          themScore={summary.themScore}
          targetScore={summary.targetScore}
        />

        <div className="rounded-xl bg-surface p-3 border border-ivory/15 space-y-1.5 text-xs">
          <div className="font-bold text-gold">{messagesEsAr.result.fairPlayHeading}</div>
          <div className="truncate font-mono text-[11px] text-muted">
            <strong className="text-ivory">{messagesEsAr.result.seedCommitmentLabel}:</strong>{' '}
            {summary.seedCommitment}
          </div>
          <div className="truncate font-mono text-[11px] text-muted">
            <strong className="text-ivory">{messagesEsAr.result.seedRevealLabel}:</strong>{' '}
            {summary.seedReveal}
          </div>
        </div>

        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ivory/15 bg-surface p-3"
          data-testid="match-result-report"
        >
          <div className="min-w-0">
            <p className="text-xs font-bold text-ivory">{messagesEsAr.result.reportHeading}</p>
            <p className="text-[11px] text-muted">{messagesEsAr.result.reportHint}</p>
          </div>
          <ReportButton
            targets={reportTargets}
            matchId={matchId ?? summary.matchId}
            myUserId={myUserId}
            label={messagesEsAr.mesa.reportPlayer}
          />
        </div>
      </div>
    </Modal>
  );
}
