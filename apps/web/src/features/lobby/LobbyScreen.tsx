import type {
  AuthUserSummary,
  GameMode,
  MatchmakingQueueStatusResponse,
  TableVisibility,
} from '@truco/shared';
import { Badge, CallButton, Toast } from '@truco/ui';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import { PracticeOfferNotice } from '../practice/PracticeOfferNotice.js';
import { PracticeSetupPanel } from '../practice/PracticeSetupPanel.js';
import { isHumanSearchActive } from '../practice/search-fallback.js';
import {
  cancelMatchmakingRequest,
  createTableRequest,
  enqueueMatchmakingRequest,
  ensureGuestOrActiveSession,
  getMatchmakingQueueStatusRequest,
  joinPublicTableRequest,
  joinTableByCodeRequest,
  type PublicLobbyFilters,
} from '../../lib/api-client.js';
import { type MatchedNotification, useLobbyRealtime } from './useLobbyRealtime.js';

export interface LobbyScreenProps {
  currentUser: AuthUserSummary | null;
  initialInviteOrCode?: string | null;
  onSessionChanged: (user: AuthUserSummary) => void;
  onNavigate: (path: string) => void;
}

export function LobbyScreen({
  currentUser,
  initialInviteOrCode = null,
  onSessionChanged,
  onNavigate,
}: LobbyScreenProps) {
  const [filters, setFilters] = useState<PublicLobbyFilters>({});
  const [queueState, setQueueState] = useState<MatchmakingQueueStatusResponse>({ status: 'IDLE' });
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const isSearching = isHumanSearchActive(queueState);

  useEffect(() => {
    if (!isSearching) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [isSearching]);

  // Formulario de creación de mesa
  const [createMode, setCreateMode] = useState<GameMode>('1v1');
  const [createVisibility, setCreateVisibility] = useState<TableVisibility>('PUBLIC');
  const [createScore, setCreateScore] = useState<15 | 30>(30);
  const [createFlor, setCreateFlor] = useState<boolean>(false);
  const [createTurnSec, setCreateTurnSec] = useState<number>(25);

  const [joinInput, setJoinInput] = useState<string>(initialInviteOrCode ?? '');
  const [busyAction, setBusyAction] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleMatched = useCallback(
    (matched: MatchedNotification) => {
      onNavigate(`/sala/${encodeURIComponent(matched.tableId)}`);
    },
    [onNavigate],
  );

  const { tables, loading, error, wsStatus, reloadHttpTables } = useLobbyRealtime({
    filters,
    enabled: Boolean(currentUser),
    onMatched: handleMatched,
  });

  // Asegurar sesión activa o de invitado al entrar al Lobby para habilitar el canal WS en tiempo real
  useEffect(() => {
    if (currentUser || initialInviteOrCode) return;
    let active = true;
    void ensureGuestOrActiveSession()
      .then((u) => {
        if (active) onSessionChanged(u);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [currentUser, initialInviteOrCode, onSessionChanged]);

  // Consultar estado inicial de cola rápida si hay sesión
  useEffect(() => {
    if (!currentUser) return;
    let active = true;
    void getMatchmakingQueueStatusRequest()
      .then((st) => {
        if (!active) return;
        setQueueState(st);
        if (st.status === 'MATCHED') {
          onNavigate(`/sala/${encodeURIComponent(st.tableId)}`);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [currentUser, onNavigate]);

  // Auto-join si se entró mediante ?invite=...
  useEffect(() => {
    if (!initialInviteOrCode) return;
    let active = true;
    setBusyAction(true);
    void ensureGuestOrActiveSession()
      .then(async (u) => {
        if (!active) return;
        onSessionChanged(u);
        const joined = await joinTableByCodeRequest(initialInviteOrCode);
        if (!active) return;
        onNavigate(`/sala/${encodeURIComponent(joined.id)}`);
      })
      .catch((err: unknown) => {
        if (active) {
          setActionError(
            err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
          );
        }
      })
      .finally(() => {
        if (active) setBusyAction(false);
      });
    return () => {
      active = false;
    };
  }, [initialInviteOrCode, onNavigate, onSessionChanged]);

  const ensureUser = async (): Promise<AuthUserSummary> => {
    if (currentUser) return currentUser;
    const u = await ensureGuestOrActiveSession();
    onSessionChanged(u);
    return u;
  };

  const handleEnqueue = async (mode: GameMode) => {
    setBusyAction(true);
    setActionError(null);
    try {
      await ensureUser();
      const res = await enqueueMatchmakingRequest({
        mode,
        rulesetCode: 'ar-standard-v1',
        competitive: false,
      });
      setQueueState(res);
      if (res.status === 'MATCHED') {
        onNavigate(`/sala/${encodeURIComponent(res.tableId)}`);
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
      );
    } finally {
      setBusyAction(false);
    }
  };

  const handleCancelQueue = async () => {
    setBusyAction(true);
    setActionError(null);
    try {
      await cancelMatchmakingRequest();
      setQueueState({ status: 'IDLE' });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
      );
    } finally {
      setBusyAction(false);
    }
  };

  const handleCreateTable = async (e: FormEvent) => {
    e.preventDefault();
    setBusyAction(true);
    setActionError(null);
    try {
      await ensureUser();
      const created = await createTableRequest({
        mode: createMode,
        visibility: createVisibility,
        targetScore: createScore,
        flor: createFlor,
        turnTimeoutMs: createTurnSec * 1_000,
      });
      onNavigate(`/sala/${encodeURIComponent(created.id)}`);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
      );
    } finally {
      setBusyAction(false);
    }
  };

  const handleJoinByCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!joinInput.trim()) return;
    setBusyAction(true);
    setActionError(null);
    try {
      await ensureUser();
      const joined = await joinTableByCodeRequest(joinInput);
      onNavigate(`/sala/${encodeURIComponent(joined.id)}`);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
      );
    } finally {
      setBusyAction(false);
    }
  };

  const handleJoinPublic = async (tableId: string) => {
    setBusyAction(true);
    setActionError(null);
    try {
      await ensureUser();
      const joined = await joinPublicTableRequest(tableId);
      onNavigate(`/sala/${encodeURIComponent(joined.id)}`);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
      );
    } finally {
      setBusyAction(false);
    }
  };

  const hasActiveFilters =
    filters.mode !== undefined ||
    filters.targetScore !== undefined ||
    filters.flor !== undefined ||
    filters.status !== undefined;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="font-display text-2xl tablet:text-3xl font-bold text-ivory">
              {messagesEsAr.lobby.title}
            </h1>
            <Badge
              variant={
                wsStatus === 'connected'
                  ? 'success'
                  : wsStatus === 'reconnecting'
                    ? 'gold'
                    : 'neutral'
              }
            >
              {wsStatus === 'connected'
                ? messagesEsAr.lobby.wsConnectedBadge
                : wsStatus === 'reconnecting'
                  ? messagesEsAr.lobby.wsReconnectingBadge
                  : messagesEsAr.lobby.wsOfflineBadge}
            </Badge>
          </div>
          <p className="text-sm text-muted max-w-2xl">{messagesEsAr.lobby.subtitle}</p>
        </div>
      </header>

      {/* Reserva de altura del aviso: cuando aparece no empuja el contenido de abajo. */}
      <div className="min-h-[3.25rem]" aria-live="polite">
        {actionError && (
          <Toast message={actionError} tone="danger" onDismiss={() => setActionError(null)} />
        )}
      </div>

      {/* P2 del UX audit: primero lo que lleva a jugar con personas. */}
      <section aria-labelledby="lobby-humans-heading" className="space-y-3">
        <div className="space-y-1">
          <h2
            id="lobby-humans-heading"
            className="font-display text-xl tablet:text-2xl font-bold text-ivory"
          >
            {messagesEsAr.lobby.loopLeadTitle}
          </h2>
        </div>
        {/* Matchmaking */}
        <section className="rounded-2xl bg-surface border border-gold/35 p-4 tablet:p-5 space-y-3 shadow-lg">
          <h2 className="font-display text-lg font-bold text-gold">
            {messagesEsAr.lobby.quickMatchTitle}
          </h2>

          {queueState.status === 'QUEUED' ? (
            <div className="space-y-2.5">
              <div
                role="status"
                aria-live="polite"
                className="rounded-xl bg-elevated border border-sky/50 p-3.5 flex items-center justify-between gap-3 flex-wrap"
              >
                <span className="text-xs font-semibold text-ivory">
                  {messagesEsAr.lobby.queuedBanner(queueState.mode, queueState.position)}
                </span>
                <CallButton
                  tone="decline"
                  disabled={busyAction}
                  onClick={() => void handleCancelQueue()}
                >
                  {messagesEsAr.lobby.cancelQueueCta}
                </CallButton>
              </div>

              <PracticeOfferNotice
                queue={queueState}
                nowMs={nowMs}
                practiceBusy={busyAction}
                onStartPractice={() =>
                  document.getElementById('machine-heading')?.scrollIntoView?.()
                }
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              <CallButton
                tone="truco"
                disabled={busyAction}
                onClick={() => void handleEnqueue('1v1')}
              >
                {messagesEsAr.lobby.queue1v1Cta}
              </CallButton>
              <CallButton
                tone="envido"
                disabled={busyAction}
                onClick={() => void handleEnqueue('2v2')}
              >
                {messagesEsAr.lobby.queue2v2Cta}
              </CallButton>
            </div>
          )}
        </section>
      </section>

      <div className="grid grid-cols-1 desktop:grid-cols-12 gap-5 items-start">
        {/* Mesas con personas: el contenido principal del lobby. */}
        <section
          aria-labelledby="lobby-tables-heading"
          className="desktop:col-span-7 rounded-2xl bg-surface border border-ivory/20 p-4 tablet:p-5 space-y-4 shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 id="lobby-tables-heading" className="font-display text-lg font-bold text-ivory">
              {messagesEsAr.lobby.tablesHeading}
            </h2>
            <button
              type="button"
              onClick={() => void reloadHttpTables()}
              className="min-h-[44px] px-3 rounded-xl bg-elevated border border-ivory/20 text-xs font-semibold text-ivory"
            >
              {messagesEsAr.lobby.refreshListCta}
            </button>
          </div>

          {/* Barra de filtros */}
          <div className="grid grid-cols-2 tablet:grid-cols-4 gap-2">
            <select
              aria-label={messagesEsAr.lobby.modeLabel}
              value={filters.mode ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setFilters((prev) => {
                  const next = { ...prev };
                  if (v === '1v1' || v === '2v2' || v === '3v3') next.mode = v;
                  else delete next.mode;
                  return next;
                });
              }}
              className="min-h-[44px] rounded-xl bg-elevated border border-ivory/20 px-2.5 text-xs font-semibold text-ivory"
            >
              <option value="">{messagesEsAr.lobby.filterAllModes}</option>
              <option value="1v1">1 vs 1</option>
              <option value="2v2">2 vs 2</option>
              <option value="3v3">3 vs 3</option>
            </select>

            <select
              aria-label={messagesEsAr.lobby.pointsLabel}
              value={filters.targetScore ? String(filters.targetScore) : ''}
              onChange={(e) => {
                const v = Number(e.target.value);
                setFilters((prev) => {
                  const next = { ...prev };
                  if (v === 15 || v === 30) next.targetScore = v;
                  else delete next.targetScore;
                  return next;
                });
              }}
              className="min-h-[44px] rounded-xl bg-elevated border border-ivory/20 px-2.5 text-xs font-semibold text-ivory"
            >
              <option value="">{messagesEsAr.lobby.filterAllScores}</option>
              <option value="15">A 15</option>
              <option value="30">A 30</option>
            </select>

            <select
              aria-label={messagesEsAr.lobby.florLabel}
              value={filters.flor === undefined ? '' : String(filters.flor)}
              onChange={(e) => {
                const v = e.target.value;
                setFilters((prev) => {
                  const next = { ...prev };
                  if (v === 'true') next.flor = true;
                  else if (v === 'false') next.flor = false;
                  else delete next.flor;
                  return next;
                });
              }}
              className="min-h-[44px] rounded-xl bg-elevated border border-ivory/20 px-2.5 text-xs font-semibold text-ivory"
            >
              <option value="">{messagesEsAr.lobby.filterAllFlor}</option>
              <option value="true">{messagesEsAr.lobby.withFlor}</option>
              <option value="false">{messagesEsAr.lobby.withoutFlor}</option>
            </select>

            <select
              aria-label="Estado de la mesa"
              value={filters.status ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setFilters((prev) => {
                  const next = { ...prev };
                  if (v === 'WAITING' || v === 'IN_GAME') next.status = v;
                  else delete next.status;
                  return next;
                });
              }}
              className="min-h-[44px] rounded-xl bg-elevated border border-ivory/20 px-2.5 text-xs font-semibold text-ivory"
            >
              <option value="">{messagesEsAr.lobby.filterAllStatuses}</option>
              <option value="WAITING">{messagesEsAr.lobby.filterWaitingOnly}</option>
              <option value="IN_GAME">{messagesEsAr.lobby.filterInGameOnly}</option>
            </select>
          </div>

          {/* Estados de carga, error y vacío */}
          {!loading && !error && tables.length > 0 && (
            <p className="text-xs text-muted" role="status">
              {messagesEsAr.lobby.tablesCount(tables.length)}
            </p>
          )}

          {loading ? (
            <div
              role="status"
              className="min-h-[12rem] rounded-xl bg-elevated/70 border border-ivory/15 p-8 text-center text-sm text-muted"
            >
              {messagesEsAr.lobby.loadingTables}
            </div>
          ) : error ? (
            <div
              role="alert"
              className="rounded-xl bg-elevated border border-danger p-5 text-center space-y-3"
            >
              <p className="text-sm font-semibold text-ivory">{error}</p>
              <CallButton tone="truco" onClick={() => void reloadHttpTables()}>
                {messagesEsAr.lobby.refreshListCta}
              </CallButton>
            </div>
          ) : tables.length === 0 ? (
            <div className="rounded-xl bg-elevated/65 border border-ivory/15 p-7 text-center space-y-3">
              <h3 className="font-display text-lg font-bold text-ivory">
                {messagesEsAr.lobby.emptyTablesTitle}
              </h3>
              <p className="text-xs text-muted max-w-md mx-auto leading-relaxed">
                {messagesEsAr.lobby.emptyTablesBody}
              </p>
              <p className="text-xs text-ivory/85 max-w-md mx-auto leading-relaxed">
                {messagesEsAr.lobby.tablesEmptyHint}
              </p>
              {hasActiveFilters && (
                <div className="pt-1">
                  <CallButton tone="neutral" onClick={() => setFilters({})}>
                    {messagesEsAr.lobby.clearFiltersCta}
                  </CallButton>
                </div>
              )}
            </div>
          ) : (
            <ul className="space-y-3 min-h-[12rem]">
              {tables.map((t) => {
                const isJoinable = t.status === 'WAITING' && t.occupiedSeats < t.maxSeats;
                return (
                  <li
                    key={t.id}
                    className="rounded-xl bg-elevated border border-ivory/20 p-4 flex items-center justify-between gap-3 flex-wrap"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="gold">{t.mode}</Badge>
                        <Badge variant="sky">{`A ${t.targetScore}`}</Badge>
                        <Badge variant={t.flor ? 'success' : 'neutral'}>
                          {t.flor ? messagesEsAr.lobby.withFlor : messagesEsAr.lobby.withoutFlor}
                        </Badge>
                        <Badge variant={t.status === 'WAITING' ? 'success' : 'neutral'}>
                          {t.status === 'WAITING'
                            ? messagesEsAr.lobby.statusWaiting
                            : messagesEsAr.lobby.statusInGame}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted">
                        {messagesEsAr.lobby.tableOwnerPrefix}{' '}
                        <strong className="text-ivory">{t.ownerNickname}</strong> ·{' '}
                        <span className="tabular-nums">
                          {messagesEsAr.lobby.seatsCountLabel(t.occupiedSeats, t.maxSeats)}
                        </span>
                      </div>
                    </div>

                    <CallButton
                      tone={isJoinable ? 'accept' : 'neutral'}
                      disabled={busyAction || !isJoinable}
                      onClick={() => void handleJoinPublic(t.id)}
                    >
                      {isJoinable
                        ? messagesEsAr.lobby.joinPublicTableCta
                        : messagesEsAr.lobby.tableFullLabel}
                    </CallButton>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {/* Ingreso por código y creación de mesa: acciones secundarias del lobby. */}
        <div className="desktop:col-span-5 space-y-5">
          {/* Unirse con código o enlace */}
          <section className="rounded-2xl bg-surface border border-ivory/20 p-4 tablet:p-5 space-y-3">
            <h2 className="font-display text-base font-bold text-ivory">
              {messagesEsAr.lobby.joinCodeBoxTitle}
            </h2>
            <form onSubmit={(e) => void handleJoinByCode(e)} className="flex gap-2 flex-wrap">
              <input
                type="text"
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value)}
                placeholder={messagesEsAr.lobby.joinCodePlaceholder}
                aria-label={messagesEsAr.lobby.joinCodeBoxTitle}
                className="flex-1 min-w-[160px] min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3 text-sm font-mono text-ivory placeholder:text-muted/60"
              />
              <button
                type="submit"
                disabled={busyAction || joinInput.trim().length < 6}
                className="min-h-[44px] px-4 rounded-xl bg-sky text-surface font-bold text-sm disabled:opacity-50"
              >
                {messagesEsAr.lobby.joinCodeSubmitCta}
              </button>
            </form>
          </section>

          {/* Armar nueva mesa */}
          <form
            onSubmit={(e) => void handleCreateTable(e)}
            className="rounded-2xl bg-surface border border-ivory/20 p-4 tablet:p-5 space-y-3.5"
          >
            <h2 className="font-display text-lg font-bold text-ivory">
              {messagesEsAr.lobby.createTableTitle}
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="create-mode" className="block text-xs font-bold text-muted">
                  {messagesEsAr.lobby.modeLabel}
                </label>
                <select
                  id="create-mode"
                  value={createMode}
                  onChange={(e) => setCreateMode(e.target.value as GameMode)}
                  className="w-full min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3 text-sm text-ivory"
                >
                  <option value="1v1">1 vs 1</option>
                  <option value="2v2">2 vs 2 (Parejas)</option>
                  <option value="3v3">3 vs 3 (Truco de 6 · 3 equipos)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="create-score" className="block text-xs font-bold text-muted">
                  {messagesEsAr.lobby.pointsLabel}
                </label>
                <select
                  id="create-score"
                  value={createScore}
                  onChange={(e) => setCreateScore(Number(e.target.value) as 15 | 30)}
                  className="w-full min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3 text-sm text-ivory"
                >
                  <option value={15}>{messagesEsAr.lobby.points15}</option>
                  <option value={30}>{messagesEsAr.lobby.points30}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="create-flor" className="block text-xs font-bold text-muted">
                  {messagesEsAr.lobby.florLabel}
                </label>
                <select
                  id="create-flor"
                  value={createFlor ? 'true' : 'false'}
                  onChange={(e) => setCreateFlor(e.target.value === 'true')}
                  className="w-full min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3 text-sm text-ivory"
                >
                  <option value="false">{messagesEsAr.lobby.withoutFlor}</option>
                  <option value="true">{messagesEsAr.lobby.withFlor}</option>
                </select>
              </div>

              <div className="space-y-1">
                <label htmlFor="create-turn" className="block text-xs font-bold text-muted">
                  {messagesEsAr.lobby.turnTimeLabel}
                </label>
                <select
                  id="create-turn"
                  value={createTurnSec}
                  onChange={(e) => setCreateTurnSec(Number(e.target.value))}
                  className="w-full min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3 text-sm text-ivory"
                >
                  <option value={15}>15 segundos</option>
                  <option value={25}>25 segundos</option>
                  <option value={45}>45 segundos</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="create-vis" className="block text-xs font-bold text-muted">
                {messagesEsAr.lobby.visibilityLabel}
              </label>
              <select
                id="create-vis"
                value={createVisibility}
                onChange={(e) => setCreateVisibility(e.target.value as TableVisibility)}
                className="w-full min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3 text-sm text-ivory"
              >
                <option value="PUBLIC">{messagesEsAr.lobby.visibilityPublic}</option>
                <option value="PRIVATE">{messagesEsAr.lobby.visibilityPrivate}</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={busyAction}
              className="w-full min-h-[44px] rounded-xl bg-gold text-surface font-bold text-sm disabled:opacity-50"
            >
              {busyAction ? messagesEsAr.lobby.creatingBusy : messagesEsAr.lobby.createSubmitCta}
            </button>
          </form>
        </div>
      </div>

      {/* Práctica: bloque aparte y secundario, después de las mesas con personas. */}
      <section aria-labelledby="lobby-practice-heading" className="space-y-2">
        <h2
          id="lobby-practice-heading"
          className="font-display text-lg tablet:text-xl font-bold text-ivory"
        >
          {messagesEsAr.lobby.practiceBlockTitle}
        </h2>
        <p className="text-xs leading-relaxed text-muted">{messagesEsAr.lobby.practiceBlockBody}</p>
        <PracticeSetupPanel
          currentUserId={currentUser?.id ?? null}
          onSessionChanged={(userId) => {
            if (currentUser) onSessionChanged({ ...currentUser, id: userId });
          }}
          onNavigate={onNavigate}
        />
      </section>
    </div>
  );
}
