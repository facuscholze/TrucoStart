import {
  QUICK_CHAT_PHRASES,
  type QuickChatPhraseId,
  type RoomSeatInfo,
  type TableStatus,
  type WsCallBid,
  type WsCallFamily,
  type WsRespondAnswer,
} from '@truco/shared';
import {
  Badge,
  CallButton,
  Hand,
  Modal,
  PlayerSeat,
  QuickChat,
  ScoreBoard,
  type SpanishCardId,
  Table,
  Toast,
} from '@truco/ui';
import { useEffect, useState } from 'react';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import { loadClientPreferences } from '../../lib/preferences.js';
import { playTableSoundCue } from '../../lib/sound-fx.js';
import { ReportButton } from '../moderation/ReportButton.js';
import { CallTray } from './CallTray.js';
import { type MatchEndedSummary, MatchResultModal } from './MatchResultModal.js';
import {
  groupServerLegalActions,
  projectHandCardsFromView,
  projectRoundsForTable,
  resolveRelativeSeats,
  type ServerPlayerView,
} from './mesa-view-model.js';

export type WsConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface GameTableSessionProps {
  readonly roomId: string;
  readonly joinCode?: string | null;
  readonly connectionStatus: WsConnectionStatus;
  readonly tableStatus: TableStatus;
  readonly seats: readonly RoomSeatInfo[];
  readonly myUserId: string | null;
  readonly view: ServerPlayerView | null;
  readonly seedCommitment: string | null;
  readonly turnDeadlineMs: number | null;
  readonly isTurnWarning: boolean;
  readonly peerGraceDeadlinesBySeat: ReadonlyMap<number, number>;
  readonly speechBubblesBySeat: ReadonlyMap<number, string>;
  readonly eventFeed: readonly string[];
  readonly matchEnded: MatchEndedSummary | null;
  /** Partida en curso/terminada de la mesa, adjunta al reportar. */
  readonly matchId?: string | null;
  /** Vencimiento del silencio vigente del propio jugador (`null` si no está silenciado). */
  readonly mutedUntil?: string | null;
  readonly toastMessage: string | null;
  /** Pista de entrenamiento vigente (solo mesas de práctica). */
  readonly practiceHint?: { readonly explanation: string; readonly suggestedAction: string } | null;
  /** `true` si la mesa es de práctica contra la máquina. */
  readonly isPractice?: boolean;
  readonly defaultCallTrayOpen?: boolean;
  readonly nowMsOverride?: number;
  readonly onDismissToast?: () => void;
  readonly onRetryConnect?: () => void;
  readonly onMarkReady: (ready: boolean) => void;
  readonly onPlayCard: (cardId: SpanishCardId) => void;
  readonly onCallBid: (bid: WsCallBid) => void;
  readonly onRespondCall: (family: WsCallFamily, answer: WsRespondAnswer) => void;
  readonly onFoldHand: () => void;
  readonly onSendSignal: (signalId: string) => void;
  readonly onSendQuickChat: (phraseId: QuickChatPhraseId) => void;
  readonly onRequestRematch: () => void;
  readonly onRequestHint?: () => void;
  readonly onDismissHint?: () => void;
  readonly onLeaveTable: () => void;
  /** Abre el perfil público de otro jugador (desde el asiento). */
  readonly onOpenPlayerProfile?: (userId: string) => void;
}

export function GameTableView({
  joinCode = null,
  connectionStatus,
  tableStatus,
  seats,
  myUserId,
  view,
  seedCommitment,
  turnDeadlineMs,
  isTurnWarning,
  peerGraceDeadlinesBySeat,
  speechBubblesBySeat,
  eventFeed,
  matchEnded,
  matchId = null,
  mutedUntil = null,
  toastMessage,
  practiceHint = null,
  isPractice = false,
  defaultCallTrayOpen = false,
  nowMsOverride,
  onDismissToast,
  onRetryConnect,
  onMarkReady,
  onPlayCard,
  onCallBid,
  onRespondCall,
  onFoldHand,
  onSendSignal,
  onSendQuickChat,
  onRequestRematch,
  onRequestHint,
  onDismissHint,
  onLeaveTable,
  onOpenPlayerProfile,
}: GameTableSessionProps) {
  const [callTrayOpen, setCallTrayOpen] = useState<boolean>(defaultCallTrayOpen);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [pendingConfirmAction, setPendingConfirmAction] = useState<
    { kind: 'FOLD' } | { kind: 'BID'; bid: WsCallBid } | null
  >(null);
  const [clockMs, setClockMs] = useState<number>(() => nowMsOverride ?? Date.now());
  const [isDesktopViewport, setIsDesktopViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1200 : false,
  );

  useEffect(() => {
    setCallTrayOpen(defaultCallTrayOpen);
  }, [defaultCallTrayOpen]);

  useEffect(() => {
    if (nowMsOverride !== undefined) {
      setClockMs(nowMsOverride);
      return;
    }
    const timer = setInterval(() => setClockMs(Date.now()), 500);
    return () => clearInterval(timer);
  }, [nowMsOverride]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setIsDesktopViewport(window.innerWidth >= 1200);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const isMuted = mutedUntil !== null && Date.parse(mutedUntil) > clockMs;

  const reportTargets = seats
    .filter((s) => s.userId !== null && !s.isBot)
    .map((s) => ({ userId: s.userId ?? '', nickname: s.nickname ?? 'Jugador' }));

  const nicknameBySeat = new Map<number, string>();
  for (const s of seats) {
    if (s.nickname) nicknameBySeat.set(s.seat, s.nickname);
  }

  const mySeatFromLobby = seats.find((s) => myUserId !== null && s.userId === myUserId);
  const mySeatIndex = view?.mySeat ?? mySeatFromLobby?.seat ?? 0;
  const myTeam = view?.myTeam ?? mySeatFromLobby?.team ?? 0;
  const otherTeam = myTeam === 0 ? 1 : 0;
  const targetScore = view?.ruleset.targetScore ?? 30;
  const usScore = view ? Number(view.scoresByTeam[String(myTeam)] ?? 0) : 0;
  const themScore = view ? Number(view.scoresByTeam[String(otherTeam)] ?? 0) : 0;

  const groupedCalls = groupServerLegalActions(view?.legalActions ?? []);
  const handCards = view ? projectHandCardsFromView(view, groupedCalls.playableCardIds) : [];
  const tableRounds = view ? projectRoundsForTable(view, nicknameBySeat) : [];
  const relSeats = resolveRelativeSeats(mySeatIndex, Math.max(2, seats.length));

  const handleGuardedCallBid = (bid: WsCallBid) => {
    if (bid === 'FALTA_ENVIDO' && loadClientPreferences().confirmCalls) {
      setPendingConfirmAction({ kind: 'BID', bid });
      return;
    }
    playTableSoundCue('call');
    onCallBid(bid);
  };

  const handleGuardedFold = () => {
    if (loadClientPreferences().confirmCalls) {
      setPendingConfirmAction({ kind: 'FOLD' });
      return;
    }
    playTableSoundCue('card');
    onFoldHand();
  };

  const handleGuardedRespond = (family: WsCallFamily, answer: WsRespondAnswer) => {
    playTableSoundCue('call');
    onRespondCall(family, answer);
  };

  const turnRemainingSec =
    turnDeadlineMs !== null ? Math.max(0, Math.ceil((turnDeadlineMs - clockMs) / 1000)) : null;

  const disconnectedPeer = seats.find((s) => s.seat !== mySeatIndex && s.userId && !s.connected);
  const peerGraceMs = disconnectedPeer
    ? (peerGraceDeadlinesBySeat.get(disconnectedPeer.seat) ?? null)
    : null;
  const peerGraceSec =
    peerGraceMs !== null ? Math.max(0, Math.ceil((peerGraceMs - clockMs) / 1000)) : null;

  const renderSeatSlot = (seatIdx: number | null, compact = false) => {
    if (seatIdx === null) return null;
    const info = seats.find((s) => s.seat === seatIdx);
    const pubSeat = view?.seats.find((s) => s.seat === seatIdx);
    const nickname = info?.nickname ?? `Asiento ${seatIdx + 1}`;
    const isActiveTurn = view?.hand.activeSeat === seatIdx && view.status === 'IN_PROGRESS';
    const profileUserId = info?.userId ?? null;
    const canOpenProfile =
      Boolean(onOpenPlayerProfile) &&
      profileUserId !== null &&
      profileUserId !== myUserId &&
      !(info?.isBot ?? false);

    return (
      <PlayerSeat
        seat={seatIdx}
        {...(canOpenProfile && profileUserId && onOpenPlayerProfile
          ? { onOpenProfile: () => onOpenPlayerProfile(profileUserId) }
          : {})}
        nickname={nickname}
        team={info?.team ?? seatIdx % 2}
        isSelf={seatIdx === mySeatIndex}
        isMano={view?.hand.manoSeat === seatIdx}
        isActiveTurn={isActiveTurn}
        connected={info?.connected ?? true}
        folded={pubSeat?.folded ?? false}
        remainingCards={pubSeat?.remainingCardCount ?? 0}
        turnRemainingSeconds={isActiveTurn ? turnRemainingSec : null}
        isTurnWarning={isActiveTurn && isTurnWarning}
        speechBubbleText={speechBubblesBySeat.get(seatIdx) ?? null}
        manoLabel={messagesEsAr.mesa.manoBadge}
        foldedLabel={messagesEsAr.mesa.foldedBadge}
        disconnectedLabel={messagesEsAr.mesa.disconnectedBadge}
        selfBadgeLabel={messagesEsAr.mesa.selfBadge}
        isBot={info?.isBot ?? false}
        botLabel={messagesEsAr.mesa.botBadge}
        compact={compact}
      />
    );
  };

  const isMySocketReconnecting =
    connectionStatus === 'reconnecting' || connectionStatus === 'disconnected';

  const practiceHintBanner =
    isPractice && practiceHint ? (
      <div
        role="status"
        aria-live="polite"
        className="rounded-2xl border-2 border-sky/50 bg-sky/10 px-4 py-3 flex items-start justify-between gap-3"
      >
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide font-bold text-sky">
            {messagesEsAr.mesa.hintTitle}
          </p>
          <p className="text-sm text-ivory leading-relaxed" data-testid="practice-hint-text">
            {practiceHint.explanation}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onDismissHint?.()}
          className="min-h-[44px] min-w-[44px] rounded-xl bg-elevated border border-ivory/25 text-ivory text-sm font-bold"
        >
          {messagesEsAr.mesa.hintDismiss}
        </button>
      </div>
    ) : null;

  const topBar = (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap">
        <ScoreBoard
          compact
          usLabel={messagesEsAr.mesa.usLabel}
          themLabel={messagesEsAr.mesa.themLabel}
          usScore={usScore}
          themScore={themScore}
          targetScore={targetScore}
        />
        {view && (
          <Badge variant="gold">{messagesEsAr.mesa.handCounter(view.hand.handNumber)}</Badge>
        )}
        {turnRemainingSec !== null && view?.status === 'IN_PROGRESS' && (
          <Badge variant={isTurnWarning ? 'danger' : 'sky'} className="tabular-nums">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8.5" r="6" stroke="currentColor" strokeWidth="1.7" />
              <path
                d="M8 5.2V8.6L10.3 10"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
            <span>{messagesEsAr.mesa.turnTimerLabel(turnRemainingSec)}</span>
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        {isPractice && (
          <button
            type="button"
            onClick={() => onRequestHint?.()}
            data-testid="practice-hint-button"
            className="min-h-[44px] px-3 rounded-xl bg-sky text-surface font-bold text-xs"
          >
            {messagesEsAr.mesa.hintCta}
          </button>
        )}
        {joinCode && (
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(joinCode);
              setCopiedCode(true);
              setTimeout(() => setCopiedCode(false), 1800);
            }}
            className="min-h-[44px] px-3 rounded-xl bg-elevated border border-gold/40 text-xs font-bold text-gold"
          >
            {copiedCode
              ? messagesEsAr.mesa.copiedJoinCode
              : messagesEsAr.mesa.copyJoinCode(joinCode)}
          </button>
        )}

        <ReportButton
          targets={reportTargets}
          matchId={matchId}
          myUserId={myUserId}
          label={messagesEsAr.mesa.reportPlayer}
        />

        <QuickChat
          disabled={isMuted}
          phrases={QUICK_CHAT_PHRASES}
          triggerLabel={messagesEsAr.mesa.quickChatTrigger}
          panelLabel={messagesEsAr.mesa.quickChatDialogLabel}
          onSelectPhrase={(id) => onSendQuickChat(id as QuickChatPhraseId)}
        />

        <button
          type="button"
          onClick={onLeaveTable}
          className="min-h-[44px] px-3 rounded-xl bg-surface border border-ivory/25 text-xs font-semibold text-ivory"
        >
          {messagesEsAr.mesa.leaveTable}
        </button>
      </div>
    </div>
  );

  const centerBanner = (
    <div className="w-full max-w-lg space-y-2">
      {isMuted && (
        <div
          role="status"
          className="rounded-xl border border-danger/50 bg-danger/10 p-3 text-xs text-danger"
        >
          Estás silenciado hasta el {new Date(mutedUntil as string).toLocaleString('es-AR')}: no
          podés usar el chat rápido ni enviar señas. Podés seguir jugando.
        </div>
      )}
      {isMySocketReconnecting && (
        <div
          role="alert"
          className="rounded-xl bg-elevated border-2 border-danger p-3 text-ivory flex items-center justify-between gap-3 flex-wrap shadow-lg"
        >
          <div className="space-y-0.5">
            <div className="text-sm font-bold text-gold">
              {messagesEsAr.reconnection.ownReconnectingTitle}
            </div>
            <div className="text-xs text-muted">
              {messagesEsAr.reconnection.ownReconnectingDetail}
            </div>
          </div>
          {onRetryConnect && (
            <CallButton tone="truco" onClick={onRetryConnect}>
              {messagesEsAr.reconnection.retryNowCta}
            </CallButton>
          )}
        </div>
      )}

      {!isMySocketReconnecting && disconnectedPeer && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl bg-elevated border border-gold/60 px-3 py-2 text-xs font-semibold text-ivory text-center"
        >
          {messagesEsAr.reconnection.peerDisconnectedBanner(
            disconnectedPeer.nickname ?? `Asiento ${disconnectedPeer.seat + 1}`,
            peerGraceSec,
          )}
        </div>
      )}

      {toastMessage && <Toast message={toastMessage} tone="info" onDismiss={onDismissToast} />}

      {tableStatus === 'WAITING' && !view && (
        <div className="rounded-2xl bg-surface/95 border border-gold/40 p-4 text-center space-y-3">
          <h2 className="font-display text-xl font-bold text-ivory">
            {messagesEsAr.mesa.waitingRoomTitle}
          </h2>
          <p className="text-xs text-muted">{messagesEsAr.mesa.waitingRoomHint}</p>
          <div className="flex justify-center">
            <CallButton
              tone="accept"
              disabled={Boolean(mySeatFromLobby?.ready)}
              onClick={() => onMarkReady(true)}
            >
              {mySeatFromLobby?.ready
                ? messagesEsAr.mesa.readyConfirmedLabel
                : messagesEsAr.mesa.markReadyCta}
            </CallButton>
          </div>
        </div>
      )}

      {view && view.status === 'IN_PROGRESS' && (
        <div className="text-center">
          <Badge
            variant={
              groupedCalls.pendingResponses.length > 0
                ? 'danger'
                : view.hand.activeSeat === mySeatIndex
                  ? 'gold'
                  : 'neutral'
            }
          >
            {groupedCalls.pendingResponses.length > 0
              ? messagesEsAr.mesa.respondCallBanner
              : view.hand.activeSeat === mySeatIndex
                ? messagesEsAr.mesa.yourTurnBanner
                : messagesEsAr.mesa.waitingTurnBanner(
                    nicknameBySeat.get(view.hand.activeSeat) ??
                      `Asiento ${view.hand.activeSeat + 1}`,
                  )}
          </Badge>
        </div>
      )}
    </div>
  );

  const bottomArea = (
    <div className="space-y-2.5">
      {groupedCalls.pendingResponses.length > 0 && !callTrayOpen && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {groupedCalls.pendingResponses.map((resp) => {
            const copy = messagesEsAr.calls.decisions[resp.decision];
            const isAccept = resp.decision === 'QUIERO' || resp.decision === 'CON_FLOR_QUIERO';
            return (
              <CallButton
                key={`quick-${resp.family}-${resp.decision}`}
                tone={isAccept ? 'accept' : 'decline'}
                subtitle={copy.subtitle}
                onClick={() => onRespondCall(resp.family, resp.decision)}
              >
                {copy.label}
              </CallButton>
            );
          })}
        </div>
      )}

      <div className="flex flex-col items-center gap-1.5">
        {view && (
          <Hand cards={handCards} size={isDesktopViewport ? 'md' : 'sm'} onPlayCard={onPlayCard} />
        )}

        <div className="w-full flex items-center justify-between gap-2 flex-wrap pt-1">
          {renderSeatSlot(relSeats.bottomSeat, true)}

          <div className="flex items-center gap-2 flex-wrap">
            {!isDesktopViewport && (
              <CallButton
                tone="truco"
                active={callTrayOpen}
                disabled={groupedCalls.totalCallCount === 0 && groupedCalls.signalIds.length === 0}
                onClick={() => setCallTrayOpen((prev) => !prev)}
              >
                {messagesEsAr.mesa.openCallTrayCta(groupedCalls.totalCallCount)}
              </CallButton>
            )}

            <CallButton
              tone="decline"
              disabled={!groupedCalls.canFoldHand}
              onClick={handleGuardedFold}
            >
              {messagesEsAr.mesa.foldHandCta}
            </CallButton>
          </div>
        </div>
      </div>
    </div>
  );

  const desktopSidePanel = isDesktopViewport ? (
    <>
      <div className="rounded-2xl bg-surface p-4 border border-gold/30 space-y-2">
        <h2 className="font-display text-base font-bold text-gold">
          {messagesEsAr.mesa.sidePanelScoreTitle}
        </h2>
        <ScoreBoard
          usLabel={messagesEsAr.mesa.usLabel}
          themLabel={messagesEsAr.mesa.themLabel}
          usScore={usScore}
          themScore={themScore}
          targetScore={targetScore}
        />
      </div>

      <CallTray
        inlineMode
        groupedCalls={groupedCalls}
        onCallBid={handleGuardedCallBid}
        onRespondCall={handleGuardedRespond}
        onSendSignal={onSendSignal}
      />

      <div className="rounded-2xl bg-surface p-4 border border-ivory/15 space-y-2 flex-1">
        <h2 className="font-display text-base font-bold text-ivory">
          {messagesEsAr.mesa.sidePanelFeedTitle}
        </h2>
        {eventFeed.length === 0 ? (
          <p className="text-xs text-muted">{messagesEsAr.mesa.sidePanelEmptyFeed}</p>
        ) : (
          <ul className="space-y-1 text-xs text-ivory/90 max-h-40 overflow-y-auto">
            {eventFeed.slice(-8).map((line, idx) => (
              <li key={idx} className="border-b border-ivory/10 pb-1">
                {line}
              </li>
            ))}
          </ul>
        )}
        {seedCommitment && (
          <p className="pt-2 text-[11px] font-mono text-muted truncate">
            {messagesEsAr.mesa.commitHashPrefix} {seedCommitment.slice(0, 18)}…
          </p>
        )}
      </div>
    </>
  ) : undefined;

  return (
    <div className="min-h-screen bg-surface text-ivory flex flex-col">
      <Table
        topBar={
          <div className="space-y-2">
            {topBar}
            {practiceHintBanner}
          </div>
        }
        topSeat={renderSeatSlot(relSeats.topSeat, !isDesktopViewport)}
        leftSeat={renderSeatSlot(relSeats.leftSeat, true)}
        rightSeat={renderSeatSlot(relSeats.rightSeat, true)}
        centerBanner={centerBanner}
        rounds={tableRounds}
        bottomArea={bottomArea}
        sidePanel={desktopSidePanel}
        emptyCenterLabel={messagesEsAr.mesa.waitingFirstCard}
        tableAriaLabel={messagesEsAr.mesa.liveTableAria}
      />

      {callTrayOpen && !isDesktopViewport && (
        <CallTray
          groupedCalls={groupedCalls}
          onCallBid={handleGuardedCallBid}
          onRespondCall={handleGuardedRespond}
          onSendSignal={onSendSignal}
          onClose={() => setCallTrayOpen(false)}
        />
      )}

      {callTrayOpen && isDesktopViewport && defaultCallTrayOpen && (
        <CallTray
          groupedCalls={groupedCalls}
          onCallBid={handleGuardedCallBid}
          onRespondCall={handleGuardedRespond}
          onSendSignal={onSendSignal}
          onClose={() => setCallTrayOpen(false)}
        />
      )}

      <Modal
        open={pendingConfirmAction !== null}
        title={
          pendingConfirmAction?.kind === 'FOLD'
            ? messagesEsAr.mesa.foldHandCta
            : messagesEsAr.calls.bids.FALTA_ENVIDO.label
        }
        onClose={() => setPendingConfirmAction(null)}
        closeLabel={messagesEsAr.profile.deleteCancelCta}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">{messagesEsAr.profile.confirmCallsToggleLabel}</p>
          <div className="flex justify-end gap-2">
            <CallButton tone="neutral" onClick={() => setPendingConfirmAction(null)}>
              {messagesEsAr.profile.deleteCancelCta}
            </CallButton>
            <CallButton
              tone="accept"
              onClick={() => {
                const act = pendingConfirmAction;
                setPendingConfirmAction(null);
                if (!act) return;
                if (act.kind === 'FOLD') {
                  playTableSoundCue('card');
                  onFoldHand();
                } else {
                  playTableSoundCue('call');
                  onCallBid(act.bid);
                }
              }}
            >
              {messagesEsAr.calls.decisions.QUIERO.label}
            </CallButton>
          </div>
        </div>
      </Modal>

      <MatchResultModal
        open={Boolean(matchEnded)}
        myTeam={myTeam}
        summary={matchEnded}
        rematchRequested={Boolean(mySeatFromLobby?.ready && tableStatus === 'FINISHED')}
        reportTargets={reportTargets}
        matchId={matchId}
        myUserId={myUserId}
        onRequestRematch={onRequestRematch}
        onExitToHome={onLeaveTable}
      />
    </div>
  );
}
