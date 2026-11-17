import type { AuthUserSummary, TableDetailResponse } from '@truco/shared';
import { Avatar, Badge, CallButton, Toast } from '@truco/ui';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell.js';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import {
  createTableInviteRequest,
  deleteTableRequest,
  ensureGuestOrActiveSession,
  getTableDetailRequest,
  leaveTableRequest,
} from '../../lib/api-client.js';
import { GameTableView } from '../mesa/GameTableView.js';
import { useLiveGameRoom } from '../mesa/useLiveGameRoom.js';

export interface WaitingRoomScreenProps {
  tableId: string;
  currentUser: AuthUserSummary | null;
  onSessionChanged: (user: AuthUserSummary) => void;
  onNavigate: (path: string) => void;
}

interface WaitingRoomConnectedProps {
  detail: TableDetailResponse;
  currentUser: AuthUserSummary | null;
  onReloadDetail: () => void;
  onNavigate: (path: string) => void;
}

function WaitingRoomConnected({
  detail,
  currentUser,
  onReloadDetail,
  onNavigate,
}: WaitingRoomConnectedProps) {
  const session = useLiveGameRoom({
    roomId: detail.roomId,
    joinCode: detail.joinCode,
  });

  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedInvite, setCopiedInvite] = useState<boolean>(false);
  const [busyAction, setBusyAction] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isGameActive =
    session.tableStatus === 'IN_GAME' || session.view !== null || session.matchEnded !== null;

  useEffect(() => {
    if (!isGameActive || typeof window === 'undefined') return;
    const qs = detail.joinCode ? `?code=${encodeURIComponent(detail.joinCode)}` : '';
    const targetUrl = `/mesa/${encodeURIComponent(detail.roomId)}${qs}`;
    if (window.location.pathname !== `/mesa/${detail.roomId}`) {
      window.history.replaceState({}, '', targetUrl);
    }
  }, [detail.joinCode, detail.roomId, isGameActive]);

  // Refrescar detalle HTTP cuando cambia la ocupación del room en vivo
  useEffect(() => {
    if (session.seats.length > 0 && session.seats.length !== detail.occupiedSeats) {
      onReloadDetail();
    }
  }, [detail.occupiedSeats, onReloadDetail, session.seats.length]);

  const handleLeave = async () => {
    setBusyAction(true);
    setErrorMsg(null);
    try {
      await leaveTableRequest(detail.id).catch(() => undefined);
      onNavigate('/lobby');
    } finally {
      setBusyAction(false);
    }
  };

  const handleDeleteOwner = async () => {
    setBusyAction(true);
    setErrorMsg(null);
    try {
      await deleteTableRequest(detail.id);
      onNavigate('/lobby');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
      setBusyAction(false);
    }
  };

  const handleCopyCode = () => {
    if (!detail.joinCode) return;
    void navigator.clipboard?.writeText(detail.joinCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1800);
  };

  const handleCopyInviteLink = async () => {
    setBusyAction(true);
    setErrorMsg(null);
    try {
      const inv = await createTableInviteRequest(detail.id);
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const fullLink = `${origin}/lobby?invite=${encodeURIComponent(inv.inviteToken)}`;
      await navigator.clipboard?.writeText(fullLink);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2200);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setBusyAction(false);
    }
  };

  if (isGameActive) {
    return <GameTableView {...session} onLeaveTable={() => void handleLeave()} />;
  }

  const liveSeatByIdx = new Map(session.seats.map((s) => [s.seat, s]));
  const myLiveSeat = session.seats.find((s) => s.userId === session.myUserId);
  const isSelfReady = myLiveSeat?.ready ?? false;

  const renderSeatCard = (seatIdx: number) => {
    const httpSeat = detail.seats.find((s) => s.seat === seatIdx);
    const liveSeat = liveSeatByIdx.get(seatIdx);
    const occupied = Boolean(liveSeat) || Boolean(httpSeat?.occupied);
    const nickname = liveSeat?.nickname ?? httpSeat?.nickname ?? null;
    const isOwner = Boolean(httpSeat?.isOwner);
    const isSelf =
      (liveSeat && session.myUserId !== null && liveSeat.userId === session.myUserId) ||
      Boolean(httpSeat?.isSelf);
    const ready = Boolean(liveSeat?.ready);

    return (
      <div
        key={seatIdx}
        className={`rounded-xl p-3.5 border flex items-center justify-between gap-3 flex-wrap ${
          occupied
            ? isSelf
              ? 'bg-elevated border-gold/65'
              : 'bg-elevated/90 border-ivory/25'
            : 'bg-surface/60 border-dashed border-ivory/20'
        }`}
      >
        {occupied && nickname ? (
          <>
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar
                nickname={nickname}
                sizePx={34}
                connected={liveSeat?.connected ?? true}
                team={seatIdx % 2}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <strong className="text-sm font-bold text-ivory truncate">{nickname}</strong>
                  {isSelf && <Badge variant="sky">{messagesEsAr.waitingRoom.selfTag}</Badge>}
                  {isOwner && <Badge variant="gold">{messagesEsAr.waitingRoom.ownerTag}</Badge>}
                </div>
                <span className="text-xs text-muted">{`Asiento #${seatIdx + 1}`}</span>
              </div>
            </div>
            <Badge variant={ready ? 'success' : 'neutral'}>
              {ready ? messagesEsAr.waitingRoom.readyTag : messagesEsAr.waitingRoom.notReadyTag}
            </Badge>
          </>
        ) : (
          <span className="text-xs text-muted py-1.5">
            {`Asiento #${seatIdx + 1} · ${messagesEsAr.waitingRoom.emptySeatLabel}`}
          </span>
        )}
      </div>
    );
  };

  const seatIndices = Array.from({ length: detail.maxSeats }, (_, i) => i);
  const usSeats = seatIndices.filter((i) => i % 2 === 0);
  const themSeats = seatIndices.filter((i) => i % 2 === 1);

  return (
    <AppShell activeSection="lobby" currentUser={currentUser} onNavigate={onNavigate}>
      <div className="max-w-4xl mx-auto space-y-5">
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={detail.visibility === 'PRIVATE' ? 'gold' : 'sky'}>
                {detail.visibility === 'PRIVATE'
                  ? messagesEsAr.waitingRoom.privateBadge
                  : messagesEsAr.waitingRoom.publicBadge}
              </Badge>
              <Badge variant="neutral">{detail.mode}</Badge>
              <Badge variant="neutral">{`A ${detail.targetScore}`}</Badge>
              <Badge variant={detail.flor ? 'success' : 'neutral'}>
                {detail.flor ? messagesEsAr.lobby.withFlor : messagesEsAr.lobby.withoutFlor}
              </Badge>
            </div>
            <h1 className="font-display text-2xl tablet:text-3xl font-bold text-ivory">
              {messagesEsAr.waitingRoom.title}
            </h1>
            <p className="text-sm text-muted max-w-2xl">{messagesEsAr.waitingRoom.subtitle}</p>
          </div>
        </header>

        {errorMsg && <Toast message={errorMsg} tone="danger" onDismiss={() => setErrorMsg(null)} />}
        {session.toastMessage && (
          <Toast message={session.toastMessage} tone="info" onDismiss={session.onDismissToast} />
        )}

        {/* Código de acceso e invitación */}
        {detail.joinCode && (
          <section className="rounded-2xl bg-surface border border-gold/45 p-4 tablet:p-5 flex items-center justify-between gap-4 flex-wrap shadow-lg">
            <div className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-wider text-muted">
                {messagesEsAr.waitingRoom.codeHeading}
              </span>
              <div
                data-testid="waiting-room-join-code"
                className="font-mono text-2xl tablet:text-3xl font-extrabold tracking-[0.22em] text-gold"
              >
                {detail.joinCode}
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              <CallButton tone="truco" onClick={handleCopyCode}>
                {copiedCode
                  ? messagesEsAr.waitingRoom.copiedCodeFeedback
                  : messagesEsAr.waitingRoom.copyCodeCta}
              </CallButton>
              <CallButton
                tone="envido"
                disabled={busyAction}
                onClick={() => void handleCopyInviteLink()}
              >
                {copiedInvite
                  ? messagesEsAr.waitingRoom.copiedInviteFeedback
                  : messagesEsAr.waitingRoom.generateInviteCta}
              </CallButton>
            </div>
          </section>
        )}

        {/* Grilla de equipos Nosotros vs Ellos */}
        <section className="grid grid-cols-1 tablet:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-surface border border-ivory/20 p-4 space-y-3">
            <h2 className="font-display text-base font-bold text-gold">
              {messagesEsAr.waitingRoom.teamUsHeading}
            </h2>
            <div className="space-y-2.5">{usSeats.map((idx) => renderSeatCard(idx))}</div>
          </div>

          <div className="rounded-2xl bg-surface border border-ivory/20 p-4 space-y-3">
            <h2 className="font-display text-base font-bold text-sky">
              {messagesEsAr.waitingRoom.teamThemHeading}
            </h2>
            <div className="space-y-2.5">{themSeats.map((idx) => renderSeatCard(idx))}</div>
          </div>
        </section>

        {/* Ready-check y controles de sala */}
        <section className="rounded-2xl bg-surface border border-gold/35 p-5 flex items-center justify-between gap-4 flex-wrap shadow-xl">
          <div className="space-y-1 max-w-lg">
            <h2 className="font-display text-lg font-bold text-ivory">
              {messagesEsAr.waitingRoom.readyCheckHeading}
            </h2>
            <p className="text-xs text-muted leading-relaxed">
              {messagesEsAr.waitingRoom.readyCheckHint}
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {detail.isOwner && (
              <CallButton
                tone="decline"
                disabled={busyAction}
                onClick={() => void handleDeleteOwner()}
              >
                {messagesEsAr.waitingRoom.closeTableOwnerCta}
              </CallButton>
            )}
            <CallButton tone="neutral" disabled={busyAction} onClick={() => void handleLeave()}>
              {messagesEsAr.waitingRoom.leaveTableCta}
            </CallButton>
            <CallButton
              tone={isSelfReady ? 'neutral' : 'accept'}
              disabled={session.connectionStatus !== 'connected'}
              onClick={() => session.onMarkReady(!isSelfReady)}
            >
              {isSelfReady
                ? messagesEsAr.waitingRoom.toggleReadyOffCta
                : messagesEsAr.waitingRoom.toggleReadyOnCta}
            </CallButton>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

export function WaitingRoomScreen({
  tableId,
  currentUser,
  onSessionChanged,
  onNavigate,
}: WaitingRoomScreenProps) {
  const [detail, setDetail] = useState<TableDetailResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    setErrorMsg(null);
    try {
      const u = currentUser ?? (await ensureGuestOrActiveSession());
      if (!currentUser) onSessionChanged(u);
      const data = await getTableDetailRequest(tableId);
      setDetail(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setLoading(false);
    }
  }, [currentUser, onSessionChanged, tableId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  if (loading && !detail) {
    return (
      <AppShell activeSection="lobby" currentUser={currentUser} onNavigate={onNavigate}>
        <div
          role="status"
          className="max-w-xl mx-auto rounded-2xl bg-surface border border-ivory/20 p-8 text-center text-sm text-muted"
        >
          {messagesEsAr.waitingRoom.loadingRoom}
        </div>
      </AppShell>
    );
  }

  if (errorMsg || !detail) {
    return (
      <AppShell activeSection="lobby" currentUser={currentUser} onNavigate={onNavigate}>
        <div
          role="alert"
          className="max-w-xl mx-auto rounded-2xl bg-surface border border-danger p-6 text-center space-y-4"
        >
          <h1 className="font-display text-xl font-bold text-ivory">
            {messagesEsAr.waitingRoom.errorRoomTitle}
          </h1>
          <p className="text-sm text-muted">{errorMsg}</p>
          <div className="flex justify-center gap-2">
            <CallButton tone="truco" onClick={() => void loadDetail()}>
              {messagesEsAr.profile.retryCta}
            </CallButton>
            <CallButton tone="neutral" onClick={() => onNavigate('/lobby')}>
              {messagesEsAr.waitingRoom.backToLobbyCta}
            </CallButton>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <WaitingRoomConnected
      detail={detail}
      currentUser={currentUser}
      onReloadDetail={() => void loadDetail()}
      onNavigate={onNavigate}
    />
  );
}
