import type {
  AuthUserSummary,
  MeResponse,
  MatchOutcome,
  PrivacyVisibility,
  SessionDeviceItem,
  UserMatchDetailResponse,
  UserMatchHistoryItem,
  UserStatsResponse,
} from '@truco/shared';
import { Avatar, Badge, CallButton, Modal, Toast } from '@truco/ui';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import { ReportButton } from '../moderation/ReportButton.js';
import {
  deleteOwnAccountRequest,
  ensureGuestOrActiveSession,
  exportAccountDataRequest,
  getMeRequest,
  getUserMatchDetailRequest,
  getUserMatchesRequest,
  getUserStatsRequest,
  listActiveSessionsRequest,
  logoutSessionRequest,
  patchMeRequest,
  revokeActiveSessionRequest,
  type UserHistoryFilters,
} from '../../lib/api-client.js';
import {
  type ClientPreferences,
  loadClientPreferences,
  mergeServerSettingsIntoPreferences,
  saveClientPreferences,
} from '../../lib/preferences.js';

export interface ProfileScreenProps {
  currentUser: AuthUserSummary | null;
  onSessionChanged: (user: AuthUserSummary | null) => void;
  onNavigate: (path: string) => void;
}

export function ProfileScreen({ currentUser, onSessionChanged, onNavigate }: ProfileScreenProps) {
  const [meData, setMeData] = useState<MeResponse | null>(null);
  const [stats, setStats] = useState<UserStatsResponse | null>(null);
  const [matches, setMatches] = useState<UserMatchHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionDeviceItem[]>([]);
  const [historyFilters, setHistoryFilters] = useState<UserHistoryFilters>({});
  const [draftHistoryFilters, setDraftHistoryFilters] = useState<UserHistoryFilters>({});
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [matchDetail, setMatchDetail] = useState<UserMatchDetailResponse | null>(null);
  const [matchDetailLoading, setMatchDetailLoading] = useState(false);
  const [matchDetailError, setMatchDetailError] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [nickname, setNickname] = useState<string>(currentUser?.nickname ?? '');
  const [bio, setBio] = useState<string>('');
  const [prefs, setPrefs] = useState<ClientPreferences>(() => loadClientPreferences());

  const [busySave, setBusySave] = useState<boolean>(false);
  const [toastInfo, setToastInfo] = useState<{
    msg: string;
    tone: 'info' | 'success' | 'danger';
  } | null>(null);

  const [deleteModalOpen, setDeleteModalOpen] = useState<boolean>(false);
  const [deletePassword, setDeletePassword] = useState<string>('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const user = currentUser ?? (await ensureGuestOrActiveSession());
      if (!currentUser) onSessionChanged(user);

      const [meRes, statsRes, matchesRes, sessionsRes] = await Promise.all([
        getMeRequest(),
        getUserStatsRequest(user.id),
        getUserMatchesRequest(user.id, undefined, 10, historyFilters),
        listActiveSessionsRequest(),
      ]);

      setMeData(meRes);
      setNickname(meRes.user.nickname);
      setBio(meRes.profile.bio);
      setPrefs(mergeServerSettingsIntoPreferences(meRes.profile.settings));
      setStats(statsRes);
      setMatches(matchesRes.items);
      setNextCursor(matchesRes.nextCursor);
      setSessions(sessionsRes.sessions);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setLoading(false);
    }
  }, [currentUser, historyFilters, onSessionChanged]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleLoadMoreMatches = async () => {
    if (!meData || !nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await getUserMatchesRequest(meData.user.id, nextCursor, 10, historyFilters);
      setMatches((prev) => [...prev, ...res.items]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setToastInfo({
        msg: err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
        tone: 'danger',
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setBusySave(true);
    try {
      const updated = await patchMeRequest({
        nickname: nickname.trim(),
        bio: bio.trim(),
      });
      setMeData(updated);
      onSessionChanged(updated.user);
      setToastInfo({ msg: messagesEsAr.profile.profileSavedToast, tone: 'success' });
    } catch (err) {
      setToastInfo({
        msg: err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
        tone: 'danger',
      });
    } finally {
      setBusySave(false);
    }
  };

  const handleTogglePref = async (
    key: 'soundEnabled' | 'animationsReduced' | 'confirmCalls' | 'highContrast' | 'largeText',
  ) => {
    const nextPrefs: ClientPreferences = {
      ...prefs,
      [key]: !prefs[key],
    };
    const saved = saveClientPreferences(nextPrefs);
    setPrefs(saved);

    if (key === 'soundEnabled' || key === 'animationsReduced' || key === 'confirmCalls') {
      await patchMeRequest({
        settings: {
          soundEnabled: saved.soundEnabled,
          animationsReduced: saved.animationsReduced,
          confirmCalls: saved.confirmCalls,
        },
      }).catch(() => undefined);
    }
  };

  const handlePrivacyChange = async (
    key: 'historyVisibility' | 'statsVisibility' | 'presenceVisibility',
    value: PrivacyVisibility,
  ) => {
    setBusySave(true);
    try {
      const updated = await patchMeRequest({ settings: { [key]: value } });
      setMeData(updated);
      const saved = mergeServerSettingsIntoPreferences(updated.profile.settings);
      setPrefs(saved);
      setToastInfo({ msg: messagesEsAr.profile.privacySaved, tone: 'success' });
    } catch (err) {
      setToastInfo({
        msg: err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
        tone: 'danger',
      });
    } finally {
      setBusySave(false);
    }
  };

  const handleOpenMatchDetail = async (matchId: string) => {
    if (!meData) return;
    setSelectedMatchId(matchId);
    setMatchDetail(null);
    setMatchDetailError(null);
    setMatchDetailLoading(true);
    try {
      const detail = await getUserMatchDetailRequest(meData.user.id, matchId);
      setMatchDetail(detail);
    } catch (err) {
      setMatchDetailError(
        err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
      );
    } finally {
      setMatchDetailLoading(false);
    }
  };

  const handleCloseMatchDetail = () => {
    setSelectedMatchId(null);
    setMatchDetail(null);
    setMatchDetailError(null);
  };

  const handleRevokeSession = async (sessionId: string) => {
    setBusySave(true);
    try {
      await revokeActiveSessionRequest(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setToastInfo({
        msg: err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
        tone: 'danger',
      });
    } finally {
      setBusySave(false);
    }
  };

  const handleLogout = async (allDevices: boolean) => {
    setBusySave(true);
    try {
      await logoutSessionRequest(allDevices);
      onSessionChanged(null);
      onNavigate('/acceso');
    } catch (err) {
      setToastInfo({
        msg: err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
        tone: 'danger',
      });
    } finally {
      setBusySave(false);
    }
  };

  const handleExportJson = async () => {
    setBusySave(true);
    try {
      const dump = await exportAccountDataRequest();
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `truco-mis-datos-${dump.user.id.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setToastInfo({
        msg: err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
        tone: 'danger',
      });
    } finally {
      setBusySave(false);
    }
  };

  const handleConfirmDeleteAccount = async () => {
    setBusySave(true);
    try {
      await deleteOwnAccountRequest(deletePassword.trim() || undefined);
      setDeleteModalOpen(false);
      onSessionChanged(null);
      onNavigate('/');
    } catch (err) {
      setToastInfo({
        msg: err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
        tone: 'danger',
      });
    } finally {
      setBusySave(false);
    }
  };

  if (loading && (!stats || !meData)) {
    return (
      <div
        role="status"
        className="rounded-2xl bg-surface border border-ivory/20 p-8 text-center text-sm text-muted"
      >
        {messagesEsAr.profile.loadingProfile}
      </div>
    );
  }

  if (loadError || !stats || !meData) {
    return (
      <div
        role="alert"
        className="rounded-2xl bg-surface border border-danger p-6 text-center space-y-4 max-w-xl mx-auto"
      >
        <h1 className="font-display text-xl font-bold text-ivory">
          {messagesEsAr.profile.errorProfileTitle}
        </h1>
        <p className="text-sm text-muted">{loadError}</p>
        <CallButton tone="truco" onClick={() => void loadAll()}>
          {messagesEsAr.profile.retryCta}
        </CallButton>
      </div>
    );
  }

  const winRatePct = Math.round(stats.winRate * 100);

  return (
    <div className="space-y-6">
      {/* Cabecera de jugador */}
      <header className="rounded-2xl bg-surface border border-gold/40 p-5 flex items-center justify-between gap-4 flex-wrap shadow-lg">
        <div className="flex items-center gap-3.5">
          <Avatar nickname={meData.user.nickname} sizePx={52} connected team={0} />
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-2xl font-bold text-ivory">{meData.user.nickname}</h1>
              <Badge variant={meData.user.isGuest ? 'gold' : 'success'}>
                {meData.user.isGuest
                  ? messagesEsAr.profile.guestBadge
                  : messagesEsAr.profile.registeredBadge}
              </Badge>
              {!meData.user.isGuest && (
                <Badge variant={meData.user.emailVerified ? 'sky' : 'neutral'}>
                  {meData.user.emailVerified
                    ? messagesEsAr.profile.verifiedBadge
                    : messagesEsAr.profile.unverifiedBadge}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted">{messagesEsAr.profile.subtitle}</p>
          </div>
        </div>

        {meData.user.isGuest && (
          <CallButton tone="accept" onClick={() => onNavigate('/acceso?tab=promote')}>
            {messagesEsAr.home.promoteBannerCta}
          </CallButton>
        )}
      </header>

      {toastInfo && (
        <Toast message={toastInfo.msg} tone={toastInfo.tone} onDismiss={() => setToastInfo(null)} />
      )}

      {/* Estadísticas oficiales reales */}
      <section className="rounded-2xl bg-surface border border-ivory/20 p-5 space-y-4">
        <h2 className="font-display text-lg font-bold text-gold">
          {messagesEsAr.profile.statsSectionTitle}
        </h2>

        <div className="grid grid-cols-2 tablet:grid-cols-5 gap-3">
          <div className="rounded-xl bg-elevated border border-ivory/15 p-3.5">
            <div className="text-xs text-muted">{messagesEsAr.profile.statPlayed}</div>
            <div className="font-display text-2xl font-bold text-ivory tabular-nums">
              {stats.matchesPlayed}
            </div>
          </div>
          <div className="rounded-xl bg-elevated border border-ivory/15 p-3.5">
            <div className="text-xs text-muted">{messagesEsAr.profile.statWinRate}</div>
            <div className="font-display text-2xl font-bold text-gold tabular-nums">
              {`${winRatePct}%`}
            </div>
          </div>
          <div className="rounded-xl bg-elevated border border-ivory/15 p-3.5">
            <div className="text-xs text-muted">{messagesEsAr.profile.statWins}</div>
            <div className="font-display text-2xl font-bold text-ivory tabular-nums">
              {stats.wins}
            </div>
          </div>
          <div className="rounded-xl bg-elevated border border-ivory/15 p-3.5">
            <div className="text-xs text-muted">{messagesEsAr.profile.statLosses}</div>
            <div className="font-display text-2xl font-bold text-ivory tabular-nums">
              {stats.losses}
            </div>
          </div>
          <div className="rounded-xl bg-elevated border border-ivory/15 p-3.5">
            <div className="text-xs text-muted">{messagesEsAr.profile.statAbandons}</div>
            <div className="font-display text-2xl font-bold text-ivory tabular-nums">
              {stats.abandons}
            </div>
          </div>
        </div>

        <div className="space-y-2.5">
          <h3 className="text-sm font-bold text-ivory">{messagesEsAr.profile.modeStatsTitle}</h3>
          <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3">
            {(['1v1', '2v2'] as const).map((mode) => {
              const modeStats = stats.byMode[mode];
              return (
                <article
                  key={mode}
                  className="rounded-xl border border-ivory/15 bg-elevated p-3.5 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-display text-base font-bold text-gold">{mode}</h4>
                    <Badge variant="neutral">
                      {messagesEsAr.profile.modeMatchesSummary(
                        modeStats.matchesPlayed,
                        Math.round(modeStats.winRate * 100),
                      )}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <p className="text-muted">
                      {messagesEsAr.profile.statWins}
                      <strong className="block text-ivory">{modeStats.wins}</strong>
                    </p>
                    <p className="text-muted">
                      {messagesEsAr.profile.statLosses}
                      <strong className="block text-ivory">{modeStats.losses}</strong>
                    </p>
                    <p className="text-muted">
                      {messagesEsAr.profile.streakLabel}
                      <strong className="block text-ivory">{modeStats.currentStreak}</strong>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-ivory/10 pt-2 text-[11px] text-muted">
                    <span>
                      {messagesEsAr.profile.callsEnvidoLabel}: {modeStats.envido.won}/
                      {modeStats.envido.resolved}
                    </span>
                    <span>
                      {messagesEsAr.profile.callsTrucoLabel}: {modeStats.truco.won}/
                      {modeStats.truco.resolved}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        {stats.matchesPlayed === 0 && (
          <p className="text-xs text-muted">{messagesEsAr.profile.emptyStatsHint}</p>
        )}
      </section>

      {/* Grilla: Historial + Ajustes y Perfil */}
      <div className="grid grid-cols-1 desktop:grid-cols-12 gap-5 items-start">
        {/* Historial real de partidas */}
        <section className="desktop:col-span-6 rounded-2xl bg-surface border border-ivory/20 p-5 space-y-4">
          <h2 className="font-display text-lg font-bold text-ivory">
            {messagesEsAr.profile.historySectionTitle}
          </h2>

          <fieldset className="rounded-xl border border-ivory/15 bg-elevated/60 p-3 space-y-2.5">
            <legend className="px-1 text-xs font-bold text-muted">
              {messagesEsAr.profile.historyFiltersHeading}
            </legend>
            <div className="grid grid-cols-1 tablet:grid-cols-3 gap-2">
              <label className="space-y-1 text-[11px] text-muted">
                <span className="block">{messagesEsAr.profile.historyFilterMode}</span>
                <select
                  value={draftHistoryFilters.mode ?? ''}
                  onChange={(event) =>
                    setDraftHistoryFilters((previous) => ({
                      ...previous,
                      mode:
                        event.target.value === ''
                          ? undefined
                          : (event.target.value as '1v1' | '2v2'),
                    }))
                  }
                  className="min-h-[40px] w-full rounded-lg border border-ivory/20 bg-surface px-2 text-xs text-ivory"
                >
                  <option value="">{messagesEsAr.profile.historyFilterAllModes}</option>
                  <option value="1v1">1 vs 1</option>
                  <option value="2v2">2 vs 2</option>
                </select>
              </label>
              <label className="space-y-1 text-[11px] text-muted">
                <span className="block">{messagesEsAr.profile.historyFilterOutcome}</span>
                <select
                  value={draftHistoryFilters.outcome ?? ''}
                  onChange={(event) =>
                    setDraftHistoryFilters((previous) => ({
                      ...previous,
                      outcome:
                        event.target.value === ''
                          ? undefined
                          : (event.target.value as MatchOutcome),
                    }))
                  }
                  className="min-h-[40px] w-full rounded-lg border border-ivory/20 bg-surface px-2 text-xs text-ivory"
                >
                  <option value="">{messagesEsAr.profile.historyFilterAllOutcomes}</option>
                  <option value="WIN">{messagesEsAr.profile.outcomeLabels.WIN}</option>
                  <option value="LOSS">{messagesEsAr.profile.outcomeLabels.LOSS}</option>
                  <option value="ABANDON">{messagesEsAr.profile.outcomeLabels.ABANDON}</option>
                </select>
              </label>
              <label className="space-y-1 text-[11px] text-muted">
                <span className="block">{messagesEsAr.profile.historyFilterBots}</span>
                <select
                  value={draftHistoryFilters.bots ?? 'ANY'}
                  onChange={(event) =>
                    setDraftHistoryFilters((previous) => ({
                      ...previous,
                      bots: event.target.value as NonNullable<UserHistoryFilters['bots']>,
                    }))
                  }
                  className="min-h-[40px] w-full rounded-lg border border-ivory/20 bg-surface px-2 text-xs text-ivory"
                >
                  <option value="ANY">{messagesEsAr.profile.historyFilterAnyBots}</option>
                  <option value="BOTS">{messagesEsAr.profile.historyFilterOnlyBots}</option>
                  <option value="HUMANS">{messagesEsAr.profile.historyFilterHumans}</option>
                </select>
              </label>
            </div>
            <div className="flex justify-end">
              <CallButton
                tone="neutral"
                disabled={loading}
                onClick={() => {
                  setMatches([]);
                  setNextCursor(null);
                  setHistoryFilters({ ...draftHistoryFilters });
                }}
              >
                {messagesEsAr.profile.historyApplyFilters}
              </CallButton>
            </div>
          </fieldset>

          {matches.length === 0 ? (
            loading ? (
              <p
                role="status"
                className="rounded-xl bg-elevated/65 border border-ivory/15 p-6 text-center text-xs text-muted"
              >
                {messagesEsAr.profile.historyLoading}
              </p>
            ) : (
              <div className="rounded-xl bg-elevated/65 border border-ivory/15 p-6 text-center space-y-3">
                <h3 className="font-display text-base font-bold text-ivory">
                  {messagesEsAr.profile.emptyHistoryTitle}
                </h3>
                <p className="text-xs text-muted leading-relaxed">
                  {messagesEsAr.profile.emptyHistoryBody}
                </p>
                <CallButton tone="accept" onClick={() => onNavigate('/lobby')}>
                  {messagesEsAr.home.exploreLobbyCta}
                </CallButton>
              </div>
            )
          ) : (
            <div className="space-y-2.5">
              <ul className="space-y-2.5">
                {matches.map((m) => (
                  <li
                    key={m.matchId}
                    className="rounded-xl bg-elevated border border-ivory/20 p-3.5 flex items-center justify-between gap-3 flex-wrap"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={m.outcome === 'WIN' ? 'success' : 'danger'}>
                          {messagesEsAr.profile.outcomeLabels[m.outcome] ?? m.outcome}
                        </Badge>
                        <Badge variant="neutral">{m.mode}</Badge>
                      </div>
                      <div className="text-xs text-muted">
                        {new Date(m.endedAt ?? m.startedAt).toLocaleDateString('es-AR', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-xl font-bold text-ivory tabular-nums">
                        {`${m.score} pts`}
                      </span>
                      <CallButton
                        tone="neutral"
                        onClick={() => void handleOpenMatchDetail(m.matchId)}
                      >
                        {messagesEsAr.profile.matchDetails}
                      </CallButton>
                    </div>
                  </li>
                ))}
              </ul>

              {nextCursor && (
                <div className="pt-2 text-center">
                  <CallButton
                    tone="neutral"
                    disabled={loadingMore}
                    onClick={() => void handleLoadMoreMatches()}
                  >
                    {messagesEsAr.profile.loadMoreHistoryCta}
                  </CallButton>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Editar perfil + Preferencias + Sesiones + Privacidad */}
        <div className="desktop:col-span-6 space-y-5">
          {/* Editar apodo y biografía */}
          <form
            onSubmit={(e) => void handleSaveProfile(e)}
            className="rounded-2xl bg-surface border border-ivory/20 p-5 space-y-3.5"
          >
            <h2 className="font-display text-lg font-bold text-ivory">
              {messagesEsAr.profile.accountSectionTitle}
            </h2>

            <div className="space-y-1">
              <label htmlFor="prof-nick" className="block text-xs font-bold text-muted">
                {messagesEsAr.profile.nicknameLabel}
              </label>
              <input
                id="prof-nick"
                type="text"
                required
                minLength={3}
                maxLength={24}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="w-full min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3.5 text-sm text-ivory"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="prof-bio" className="block text-xs font-bold text-muted">
                {messagesEsAr.profile.bioLabel}
              </label>
              <textarea
                id="prof-bio"
                rows={2}
                maxLength={280}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder={messagesEsAr.profile.bioPlaceholder}
                className="w-full rounded-xl bg-elevated border border-ivory/25 p-3 text-sm text-ivory placeholder:text-muted/60"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busySave}
                className="min-h-[44px] px-5 rounded-xl bg-gold text-surface font-bold text-sm disabled:opacity-50"
              >
                {busySave
                  ? messagesEsAr.profile.savingProfileBusy
                  : messagesEsAr.profile.saveProfileCta}
              </button>
            </div>
          </form>

          {/* Preferencias y Accesibilidad */}
          <section className="rounded-2xl bg-surface border border-ivory/20 p-5 space-y-3">
            <h2 className="font-display text-lg font-bold text-ivory">
              {messagesEsAr.profile.settingsSectionTitle}
            </h2>

            {(
              [
                ['soundEnabled', messagesEsAr.profile.soundToggleLabel],
                ['animationsReduced', messagesEsAr.profile.reducedMotionToggleLabel],
                ['confirmCalls', messagesEsAr.profile.confirmCallsToggleLabel],
                ['highContrast', messagesEsAr.profile.highContrastToggleLabel],
                ['largeText', messagesEsAr.profile.largeTextToggleLabel],
              ] as const
            ).map(([key, label]) => {
              const checked = prefs[key];
              return (
                <div
                  key={key}
                  className="rounded-xl bg-elevated border border-ivory/15 p-3 flex items-center justify-between gap-3"
                >
                  <span className="text-xs tablet:text-sm font-semibold text-ivory">{label}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={checked}
                    aria-label={label}
                    onClick={() => void handleTogglePref(key)}
                    className={`min-h-[44px] min-w-[68px] px-3 rounded-xl font-bold text-xs border transition-colors ${
                      checked
                        ? 'bg-gold text-surface border-gold'
                        : 'bg-surface text-muted border-ivory/25'
                    }`}
                  >
                    {checked ? 'Sí' : 'No'}
                  </button>
                </div>
              );
            })}

            <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3 border-t border-ivory/10 pt-3">
              <label className="space-y-1.5 text-xs font-semibold text-ivory">
                <span className="block">{messagesEsAr.profile.historyVisibilityLabel}</span>
                <select
                  value={prefs.historyVisibility}
                  disabled={busySave}
                  onChange={(event) =>
                    void handlePrivacyChange(
                      'historyVisibility',
                      event.target.value as PrivacyVisibility,
                    )
                  }
                  className="min-h-[44px] w-full rounded-xl border border-ivory/25 bg-elevated px-3 text-sm text-ivory disabled:opacity-50"
                >
                  <option value="ALL">{messagesEsAr.profile.visibilityAll}</option>
                  <option value="FRIENDS">{messagesEsAr.profile.visibilityFriends}</option>
                  <option value="NOBODY">{messagesEsAr.profile.visibilityNobody}</option>
                </select>
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-ivory">
                <span className="block">{messagesEsAr.profile.statsVisibilityLabel}</span>
                <select
                  value={prefs.statsVisibility}
                  disabled={busySave}
                  onChange={(event) =>
                    void handlePrivacyChange(
                      'statsVisibility',
                      event.target.value as PrivacyVisibility,
                    )
                  }
                  className="min-h-[44px] w-full rounded-xl border border-ivory/25 bg-elevated px-3 text-sm text-ivory disabled:opacity-50"
                >
                  <option value="ALL">{messagesEsAr.profile.visibilityAll}</option>
                  <option value="FRIENDS">{messagesEsAr.profile.visibilityFriends}</option>
                  <option value="NOBODY">{messagesEsAr.profile.visibilityNobody}</option>
                </select>
              </label>
              <label className="space-y-1.5 text-xs font-semibold text-ivory">
                <span className="block">{messagesEsAr.profile.presenceVisibilityLabel}</span>
                <select
                  value={prefs.presenceVisibility}
                  disabled={busySave}
                  onChange={(event) =>
                    void handlePrivacyChange(
                      'presenceVisibility',
                      event.target.value as PrivacyVisibility,
                    )
                  }
                  className="min-h-[44px] w-full rounded-xl border border-ivory/25 bg-elevated px-3 text-sm text-ivory disabled:opacity-50"
                >
                  <option value="ALL">{messagesEsAr.profile.visibilityAll}</option>
                  <option value="FRIENDS">{messagesEsAr.profile.visibilityFriends}</option>
                  <option value="NOBODY">{messagesEsAr.profile.visibilityNobody}</option>
                </select>
              </label>
            </div>
          </section>

          {/* Sesiones activas y dispositivos */}
          <section className="rounded-2xl bg-surface border border-ivory/20 p-5 space-y-3.5">
            <h2 className="font-display text-lg font-bold text-ivory">
              {messagesEsAr.profile.sessionsSectionTitle}
            </h2>

            {sessions.length === 0 ? (
              <p className="text-xs text-muted">{messagesEsAr.profile.emptySessionsText}</p>
            ) : (
              <ul className="space-y-2">
                {sessions.map((sess) => (
                  <li
                    key={sess.id}
                    className="rounded-xl bg-elevated border border-ivory/15 p-3 flex items-center justify-between gap-3 flex-wrap"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-ivory truncate max-w-[230px]">
                          {sess.deviceName}
                        </span>
                        {sess.isCurrent && (
                          <Badge variant="success">{messagesEsAr.profile.currentDeviceTag}</Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted">
                        {new Date(sess.lastUsedAt).toLocaleDateString('es-AR')}
                      </div>
                    </div>
                    {!sess.isCurrent && (
                      <CallButton
                        tone="decline"
                        disabled={busySave}
                        onClick={() => void handleRevokeSession(sess.id)}
                      >
                        {messagesEsAr.profile.revokeDeviceCta}
                      </CallButton>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <CallButton
                tone="neutral"
                disabled={busySave}
                onClick={() => void handleLogout(false)}
              >
                {messagesEsAr.profile.revokeDeviceCta}
              </CallButton>
              <CallButton
                tone="decline"
                disabled={busySave}
                onClick={() => void handleLogout(true)}
              >
                {messagesEsAr.profile.logoutAllDevicesCta}
              </CallButton>
            </div>
          </section>

          {/* Privacidad, Exportar JSON y Eliminar cuenta */}
          <section className="rounded-2xl bg-surface border border-danger/50 p-5 space-y-3.5">
            <h2 className="font-display text-lg font-bold text-ivory">
              {messagesEsAr.profile.privacySectionTitle}
            </h2>
            <p className="text-xs text-muted leading-relaxed">
              {messagesEsAr.profile.exportDataBody}
            </p>
            <div className="flex flex-wrap gap-2.5">
              <CallButton
                tone="neutral"
                disabled={busySave}
                onClick={() => void handleExportJson()}
              >
                {messagesEsAr.profile.exportDataCta}
              </CallButton>
              <CallButton
                tone="decline"
                disabled={busySave}
                onClick={() => {
                  setDeletePassword('');
                  setDeleteModalOpen(true);
                }}
              >
                {messagesEsAr.profile.deleteOpenConfirmCta}
              </CallButton>
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={selectedMatchId !== null}
        title={messagesEsAr.profile.matchDetailTitle}
        onClose={handleCloseMatchDetail}
        closeLabel={messagesEsAr.profile.matchDetailClose}
      >
        <div className="max-h-[70vh] space-y-4 overflow-y-auto">
          {matchDetailLoading && (
            <p role="status" className="text-sm text-muted">
              {messagesEsAr.profile.matchDetailLoading}
            </p>
          )}
          {matchDetailError && (
            <p role="alert" className="text-sm text-danger">
              {matchDetailError}
            </p>
          )}
          {matchDetail && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="sky">{matchDetail.mode}</Badge>
                <Badge variant="neutral">{matchDetail.rulesetCode}</Badge>
                <Badge variant="gold">
                  {matchDetail.hasBots
                    ? messagesEsAr.profile.historyFilterOnlyBots
                    : messagesEsAr.profile.historyFilterHumans}
                </Badge>
              </div>
              <div className="rounded-xl border border-ivory/15 bg-elevated p-3 space-y-1">
                <p className="text-xs font-bold text-ivory">
                  {messagesEsAr.profile.seedCommitmentLabel}
                </p>
                <code className="block break-all text-[10px] text-muted">
                  {matchDetail.seedCommitment}
                </code>
                {matchDetail.result.winnerTeam !== null && (
                  <p className="pt-1 text-xs text-muted">
                    {messagesEsAr.profile.winnerTeamLabel(matchDetail.result.winnerTeam + 1)}
                  </p>
                )}
              </div>

              <section className="space-y-2">
                <h3 className="text-sm font-bold text-ivory">
                  {messagesEsAr.profile.matchDetailPlayers}
                </h3>
                <ul className="space-y-2">
                  {matchDetail.players.map((player) => (
                    <li
                      key={player.userId}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ivory/15 bg-elevated p-3"
                    >
                      <div>
                        <p className="text-sm font-semibold text-ivory">
                          {player.nickname}
                          {player.isSelf ? ` · ${messagesEsAr.profile.playerSelfTag}` : ''}
                        </p>
                        <p className="text-[11px] text-muted">
                          {messagesEsAr.profile.playerSummary(
                            player.team + 1,
                            player.score,
                            messagesEsAr.profile.outcomeLabels[player.outcome] ?? player.outcome,
                          )}
                        </p>
                      </div>
                      {!player.isSelf && (
                        <ReportButton
                          targets={[{ userId: player.userId, nickname: player.nickname }]}
                          matchId={matchDetail.matchId}
                          myUserId={meData.user.id}
                          label={messagesEsAr.profile.matchReportPlayer}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-bold text-ivory">
                  {messagesEsAr.profile.matchDetailEvents}
                </h3>
                {matchDetail.events.length === 0 ? (
                  <p className="text-xs text-muted">
                    {messagesEsAr.profile.matchDetailEmptyEvents}
                  </p>
                ) : (
                  <ol className="space-y-1.5">
                    {matchDetail.events.map((event) => (
                      <li
                        key={`${event.seq}-${event.type}`}
                        className="flex items-center justify-between gap-3 rounded-lg bg-elevated/70 px-3 py-2 text-xs"
                      >
                        <span className="text-ivory">
                          {messagesEsAr.profile.matchEventTypes[event.type] ?? event.type}
                        </span>
                        <time className="shrink-0 text-[10px] text-muted">
                          {new Date(event.at).toLocaleTimeString('es-AR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              <p className="rounded-lg border border-sky/20 bg-sky/5 p-3 text-xs text-muted">
                {messagesEsAr.profile.matchDetailNoCards}
              </p>
            </>
          )}
        </div>
      </Modal>

      {/* Modal de confirmación de borrado definitivo */}
      <Modal
        open={deleteModalOpen}
        title={messagesEsAr.profile.deleteConfirmTitle}
        onClose={() => setDeleteModalOpen(false)}
        closeLabel={messagesEsAr.profile.deleteCancelCta}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted leading-relaxed">
            {messagesEsAr.profile.deleteAccountBody}
          </p>
          {!meData.user.isGuest && (
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder={messagesEsAr.profile.deletePasswordPlaceholder}
              aria-label={messagesEsAr.profile.deletePasswordPlaceholder}
              className="w-full min-h-[44px] rounded-xl bg-elevated border border-danger px-3.5 text-sm text-ivory"
            />
          )}
          <div className="flex justify-end gap-2.5">
            <CallButton tone="neutral" onClick={() => setDeleteModalOpen(false)}>
              {messagesEsAr.profile.deleteCancelCta}
            </CallButton>
            <CallButton
              tone="decline"
              disabled={busySave}
              onClick={() => void handleConfirmDeleteAccount()}
            >
              {messagesEsAr.profile.deleteConfirmActionCta}
            </CallButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
