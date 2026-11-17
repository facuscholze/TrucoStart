import { DEFAULT_APP_NAME, type AuthUserSummary } from '@truco/shared';
import { Badge, CallButton, Card, Toast } from '@truco/ui';
import { type FormEvent, useState } from 'react';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import { PracticeSetupPanel } from '../practice/PracticeSetupPanel.js';
import {
  createTableRequest,
  enqueueMatchmakingRequest,
  ensureGuestOrActiveSession,
  joinTableByCodeRequest,
} from '../../lib/api-client.js';

export interface HomeScreenProps {
  currentUser: AuthUserSummary | null;
  sessionLoading: boolean;
  onSessionChanged: (user: AuthUserSummary) => void;
  onNavigate: (path: string) => void;
  onOpenOnboarding?: () => void;
}

export function HomeScreen({
  currentUser,
  sessionLoading,
  onSessionChanged,
  onNavigate,
  onOpenOnboarding,
}: HomeScreenProps) {
  const appName = (import.meta.env?.['VITE_APP_NAME'] as string | undefined) ?? DEFAULT_APP_NAME;
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [busyAction, setBusyAction] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  const ensureUser = async (): Promise<AuthUserSummary> => {
    if (currentUser) return currentUser;
    const u = await ensureGuestOrActiveSession();
    onSessionChanged(u);
    return u;
  };

  const handleQuickMatch = async (mode: '1v1' | '2v2') => {
    setBusyAction(true);
    setErrorMsg(null);
    try {
      await ensureUser();
      const res = await enqueueMatchmakingRequest({ mode, rulesetCode: 'ar-standard-v1' });
      if (res.status === 'MATCHED') {
        onNavigate(`/sala/${encodeURIComponent(res.tableId)}`);
      } else {
        onNavigate('/lobby');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setBusyAction(false);
    }
  };

  const handleQuickPrivateCreate = async (
    mode: '1v1' | '2v2',
    targetScore: 15 | 30,
    flor: boolean,
  ) => {
    setBusyAction(true);
    setErrorMsg(null);
    try {
      await ensureUser();
      const created = await createTableRequest({
        mode,
        visibility: 'PRIVATE',
        targetScore,
        flor,
        turnTimeoutMs: 30_000,
      });
      onNavigate(`/sala/${encodeURIComponent(created.id)}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setBusyAction(false);
    }
  };

  const handleJoinByCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput.trim()) return;
    setBusyAction(true);
    setErrorMsg(null);
    try {
      await ensureUser();
      const joined = await joinTableByCodeRequest(joinCodeInput);
      onNavigate(`/sala/${encodeURIComponent(joined.id)}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Hero principal con naipes criollos */}
      <section
        aria-labelledby="app-heading"
        className="rounded-3xl bg-surface border-2 border-gold/40 p-5 tablet:p-8 shadow-2xl grid grid-cols-1 desktop:grid-cols-12 gap-6 items-center"
      >
        <div className="desktop:col-span-8 space-y-3.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <Badge variant="gold">{messagesEsAr.home.heroBadge}</Badge>
            {sessionLoading ? (
              <Badge variant="neutral">{messagesEsAr.home.loadingSession}</Badge>
            ) : currentUser ? (
              <Badge variant="success">
                {messagesEsAr.launcher.guestReadyPrefix} {currentUser.nickname}
              </Badge>
            ) : null}
          </div>

          <div className="space-y-1">
            <h1
              id="app-heading"
              className="font-display text-3xl tablet:text-4xl font-bold text-ivory"
            >
              {appName}
            </h1>
            <p className="font-display text-lg tablet:text-xl font-semibold text-gold">
              {messagesEsAr.home.heroTitle}
            </p>
          </div>
          <p className="text-sm tablet:text-base text-muted leading-relaxed max-w-2xl">
            {messagesEsAr.home.heroSubtitle}
          </p>

          <div className="flex flex-wrap gap-2.5 pt-1">
            <CallButton tone="accept" onClick={() => onNavigate('/lobby')}>
              {messagesEsAr.home.exploreLobbyCta}
            </CallButton>
            <CallButton tone="neutral" onClick={() => onNavigate('/aprender')}>
              {messagesEsAr.home.openLearnCta}
            </CallButton>
            <CallButton tone="neutral" onClick={() => onNavigate('/anotador')}>
              {messagesEsAr.home.openScorerCta}
            </CallButton>
            {onOpenOnboarding && (
              <CallButton tone="neutral" onClick={onOpenOnboarding}>
                {messagesEsAr.onboarding.dialogTitle}
              </CallButton>
            )}
          </div>
        </div>

        <div
          aria-hidden="true"
          className="hidden desktop:flex desktop:col-span-4 items-center justify-center gap-2"
        >
          <div style={{ transform: 'rotate(-8deg)' }}>
            <Card rank={1} suit="espadas" size="md" />
          </div>
          <div style={{ transform: 'translateY(-8px)' }}>
            <Card rank={1} suit="bastos" size="md" />
          </div>
          <div style={{ transform: 'rotate(8deg)' }}>
            <Card rank={7} suit="espadas" size="md" />
          </div>
        </div>
      </section>

      {isOffline && (
        <div
          role="status"
          className="rounded-2xl bg-elevated border border-gold/55 p-4 text-sm text-ivory"
        >
          {messagesEsAr.home.offlineNotice}
        </div>
      )}

      {errorMsg && <Toast message={errorMsg} tone="danger" onDismiss={() => setErrorMsg(null)} />}

      {/* Grilla de acciones rápidas */}
      <div className="grid grid-cols-1 desktop:grid-cols-2 gap-5">
        {/* Partida rápida (Matchmaking) */}
        <section className="rounded-2xl bg-surface border border-ivory/20 p-5 space-y-3.5 shadow-lg">
          <h2 className="font-display text-xl font-bold text-gold">
            {messagesEsAr.home.quickPlaySectionTitle}
          </h2>
          <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3">
            <CallButton
              tone="accept"
              subtitle={messagesEsAr.home.quickPlay1v1Sub}
              disabled={busyAction || isOffline}
              onClick={() => void handleQuickMatch('1v1')}
            >
              {messagesEsAr.home.quickPlay1v1Title}
            </CallButton>
            <CallButton
              tone="envido"
              subtitle={messagesEsAr.home.quickPlay2v2Sub}
              disabled={busyAction || isOffline}
              onClick={() => void handleQuickMatch('2v2')}
            >
              {messagesEsAr.home.quickPlay2v2Title}
            </CallButton>
          </div>
        </section>

        {/* Modo práctica: jugar contra la máquina */}
        <PracticeSetupPanel
          currentUserId={currentUser?.id ?? null}
          onSessionChanged={() => {
            void ensureGuestOrActiveSession()
              .then(onSessionChanged)
              .catch(() => undefined);
          }}
          onNavigate={onNavigate}
        />

        {/* Mesa privada rápida + Unirse por código */}
        <section className="rounded-2xl bg-surface border border-ivory/20 p-5 space-y-3.5 shadow-lg">
          <h2 className="font-display text-xl font-bold text-ivory">
            {messagesEsAr.home.privateSectionTitle}
          </h2>
          <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3">
            <CallButton
              tone="truco"
              subtitle={messagesEsAr.launcher.points15Label}
              disabled={busyAction || isOffline}
              onClick={() => void handleQuickPrivateCreate('1v1', 15, false)}
            >
              {messagesEsAr.launcher.create1v1Title}
            </CallButton>
            <CallButton
              tone="flor"
              subtitle={messagesEsAr.launcher.points30FlorLabel}
              disabled={busyAction || isOffline}
              onClick={() => void handleQuickPrivateCreate('2v2', 30, true)}
            >
              {messagesEsAr.launcher.create2v2Title}
            </CallButton>
          </div>

          <form onSubmit={(e) => void handleJoinByCode(e)} className="flex gap-2 flex-wrap pt-1">
            <input
              type="text"
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value)}
              placeholder={messagesEsAr.home.joinCodePlaceholder}
              aria-label={messagesEsAr.launcher.joinCodeAriaLabel}
              className="flex-1 min-w-[170px] min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3.5 text-sm font-mono uppercase text-ivory placeholder:text-muted/60"
            />
            <button
              type="submit"
              disabled={busyAction || isOffline || joinCodeInput.trim().length < 6}
              className="min-h-[44px] px-4 rounded-xl bg-sky text-surface font-bold text-sm disabled:opacity-50"
            >
              {messagesEsAr.home.joinCodeCta}
            </button>
          </form>
        </section>
      </div>

      {/* Banner de promoción si está jugando como invitado */}
      {currentUser?.isGuest && (
        <section className="rounded-2xl bg-elevated border border-gold/40 p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="space-y-1 max-w-xl">
            <h2 className="font-display text-lg font-bold text-gold">
              {messagesEsAr.home.promoteBannerTitle}
            </h2>
            <p className="text-xs tablet:text-sm text-muted leading-relaxed">
              {messagesEsAr.home.promoteBannerBody}
            </p>
          </div>
          <CallButton tone="truco" onClick={() => onNavigate('/acceso?tab=promote')}>
            {messagesEsAr.home.promoteBannerCta}
          </CallButton>
        </section>
      )}

      {import.meta.env.DEV && (
        <div className="flex justify-end">
          <CallButton tone="neutral" onClick={() => onNavigate('/dev/mesa')}>
            {messagesEsAr.launcher.devBotRouteCta}
          </CallButton>
        </div>
      )}
    </div>
  );
}
