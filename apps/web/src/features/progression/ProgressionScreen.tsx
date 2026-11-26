import type { AuthUserSummary, ProgressionSummary } from '@truco/shared';
import { useCallback, useEffect, useState } from 'react';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import {
  claimProgressionMissionRequest,
  getMyProgressionRequest,
  markProgressionNotificationReadRequest,
  redeemProgressionCosmeticRequest,
} from '../../lib/api-client.js';

const copy = messagesEsAr.progression;

function translated(dictionary: Readonly<Record<string, string>>, key: string): string {
  return dictionary[key] ?? key;
}

function ProgressBar({ value, label }: { readonly value: number; readonly label: string }) {
  const percentage = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentage}
      className="h-3 overflow-hidden rounded-full bg-surface/80 ring-1 ring-gold/25"
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-gold via-amber-300 to-emerald-300 transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

export function ProgressionScreen({
  currentUser,
  onNavigate,
}: {
  readonly currentUser: AuthUserSummary | null;
  readonly onNavigate: (path: string) => void;
}) {
  const [summary, setSummary] = useState<ProgressionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      setSummary(await getMyProgressionRequest());
    } catch {
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void load();
  }, [load]);

  const claimMission = async (missionId: string) => {
    setBusyId(missionId);
    setError(null);
    try {
      const result = await claimProgressionMissionRequest(missionId);
      setSummary(result.progression);
    } catch {
      setError(copy.loadError);
    } finally {
      setBusyId(null);
    }
  };

  const redeemCosmetic = async (cosmeticId: string) => {
    setBusyId(cosmeticId);
    setError(null);
    try {
      const result = await redeemProgressionCosmeticRequest(cosmeticId);
      setSummary(result.progression);
    } catch {
      setError(copy.cosmeticRedeemError);
    } finally {
      setBusyId(null);
    }
  };

  const readNotification = async (notificationId: string) => {
    setBusyId(notificationId);
    try {
      await markProgressionNotificationReadRequest(notificationId);
      setSummary((current) =>
        current
          ? {
              ...current,
              notifications: current.notifications.map((notification) =>
                notification.id === notificationId
                  ? { ...notification, readAt: new Date().toISOString() }
                  : notification,
              ),
            }
          : current,
      );
    } catch {
      setError(copy.loadError);
    } finally {
      setBusyId(null);
    }
  };

  if (!currentUser) {
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-gold/25 bg-surface/90 p-6 text-center shadow-xl tablet:p-10">
        <span aria-hidden="true" className="text-5xl">
          ✦
        </span>
        <h1 className="mt-4 font-display text-3xl font-bold text-ivory">{copy.signInTitle}</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted">
          {copy.signInDescription}
        </p>
        <button
          type="button"
          onClick={() => onNavigate('/acceso')}
          className="mt-6 min-h-11 rounded-xl bg-gold px-5 py-2.5 text-sm font-bold text-surface hover:bg-gold/90"
        >
          {messagesEsAr.nav.auth}
        </button>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold">
            {messagesEsAr.brand.stageTag}
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold text-ivory">{copy.pageTitle}</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{copy.pageSubtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="min-h-11 self-start rounded-xl border border-ivory/20 bg-surface px-4 py-2 text-sm font-semibold text-ivory hover:border-gold/50 disabled:opacity-60 sm:self-auto"
        >
          {copy.retry}
        </button>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger-strong"
        >
          {error}
        </p>
      )}

      {loading && !summary ? (
        <div
          role="status"
          className="rounded-2xl border border-ivory/10 bg-surface/70 p-8 text-center text-sm text-muted"
        >
          {messagesEsAr.home.loadingSession}
        </div>
      ) : summary ? (
        <>
          <section className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(240px,0.8fr)]">
            <article className="overflow-hidden rounded-3xl border border-gold/30 bg-gradient-to-br from-[#233c31] via-surface to-[#302915] p-5 shadow-xl tablet:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-gold">
                    {copy.levelLabel}
                  </p>
                  <p className="mt-1 font-display text-5xl font-bold text-ivory">{summary.level}</p>
                </div>
                <div className="rounded-2xl border border-gold/30 bg-surface/55 px-4 py-3 text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {copy.xpLabel}
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-gold">
                    {summary.xpTotal.toLocaleString('es-AR')}
                  </p>
                </div>
              </div>
              <div
                key={summary.xpTotal}
                className="mt-6 animate-[progression-pop_360ms_ease-out] motion-reduce:animate-none"
              >
                <ProgressBar
                  value={summary.levelProgress}
                  label={`${copy.levelLabel} ${summary.level}`}
                />
                <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-ivory/65">
                  <span>
                    {summary.xpInLevel} / {summary.xpForNextLevel} {copy.xpLabel}
                  </span>
                  <span>{copy.xpToNext(summary.xpForNextLevel - summary.xpInLevel)}</span>
                </div>
              </div>
            </article>

            <article className="flex flex-col justify-between rounded-3xl border border-emerald-200/20 bg-emerald-950/35 p-5 tablet:p-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-200">
                  {copy.walletTitle}
                </p>
                <p className="mt-2 font-display text-4xl font-bold tabular-nums text-ivory">
                  {summary.wallet.balance.toLocaleString('es-AR')}
                </p>
              </div>
              <p className="mt-4 text-xs leading-5 text-emerald-100/70">{copy.walletDisclosure}</p>
            </article>
          </section>

          <section className="rounded-3xl border border-gold/20 bg-surface/70 p-4 tablet:p-6">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl font-bold text-ivory">{copy.missionsTitle}</h2>
                <p className="mt-1 text-xs text-muted">{copy.walletDisclosure}</p>
              </div>
              <span className="rounded-full border border-gold/30 px-3 py-1 text-xs font-bold text-gold">
                {summary.missions.length}
              </span>
            </div>
            {summary.missions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-ivory/15 p-5 text-center text-sm text-muted">
                {copy.noMissions}
              </p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {summary.missions.map((mission) => {
                  const complete = mission.completedAt !== null;
                  const claimed = mission.claimedAt !== null;
                  return (
                    <article
                      key={mission.id}
                      className="rounded-2xl border border-ivory/10 bg-cloth/50 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gold">
                            {mission.period === 'DAILY' ? copy.missionDaily : copy.missionWeekly}
                          </p>
                          <h3 className="mt-1 font-semibold text-ivory">
                            {translated(copy.titleByKey, mission.titleKey)}
                          </h3>
                          <p className="mt-1 text-xs leading-5 text-muted">
                            {translated(copy.descriptionByKey, mission.descriptionKey)}
                          </p>
                        </div>
                        {complete && (
                          <span aria-label={copy.completed} className="text-emerald-300">
                            ✓
                          </span>
                        )}
                      </div>
                      <div className="mt-4">
                        <ProgressBar
                          value={mission.progress / mission.target}
                          label={translated(copy.titleByKey, mission.titleKey)}
                        />
                        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ivory/60">
                          <span>{copy.missionProgress(mission.progress, mission.target)}</span>
                          <span>{copy.missionReward(mission.rewardXp, mission.rewardCoins)}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={!complete || claimed || busyId === mission.id}
                        onClick={() => void claimMission(mission.id)}
                        className="mt-4 min-h-10 w-full rounded-xl border border-gold/45 bg-gold/10 px-3 py-2 text-sm font-bold text-gold transition hover:bg-gold/20 disabled:cursor-not-allowed disabled:border-ivory/10 disabled:bg-surface/40 disabled:text-muted"
                      >
                        {claimed
                          ? copy.claimed
                          : complete
                            ? copy.claimMission
                            : copy.missionProgress(mission.progress, mission.target)}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-ivory/10 bg-surface/65 p-4 tablet:p-6">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl font-bold text-ivory">
                  {copy.achievementsTitle}
                </h2>
                <p className="mt-1 text-xs text-muted">
                  {copy.achievementUnlocked}:{' '}
                  {summary.achievements.filter((achievement) => achievement.unlockedAt).length} /{' '}
                  {summary.achievements.length}
                </p>
              </div>
              <span className="text-2xl text-gold" aria-hidden="true">
                ✦
              </span>
            </div>
            {summary.achievements.length === 0 ? (
              <p className="rounded-xl border border-dashed border-ivory/15 p-5 text-center text-sm text-muted">
                {copy.noAchievements}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {summary.achievements.map((achievement) => {
                  const unlocked = achievement.unlockedAt !== null;
                  return (
                    <article
                      key={achievement.id}
                      className={`rounded-2xl border p-4 ${unlocked ? 'border-gold/40 bg-gold/10' : 'border-ivory/10 bg-cloth/40 opacity-80'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-surface text-lg text-gold"
                          aria-hidden="true"
                        >
                          {achievement.icon === 'cards'
                            ? '🂡'
                            : achievement.icon === 'book'
                              ? '▤'
                              : achievement.icon === 'shield'
                                ? '◇'
                                : '♠'}
                        </span>
                        {unlocked && (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-gold">
                            {copy.achievementUnlocked}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-3 font-semibold text-ivory">
                        {translated(copy.titleByKey, achievement.titleKey)}
                      </h3>
                      <p className="mt-1 min-h-10 text-xs leading-5 text-muted">
                        {translated(copy.descriptionByKey, achievement.descriptionKey)}
                      </p>
                      <ProgressBar
                        value={achievement.progress / achievement.target}
                        label={translated(copy.titleByKey, achievement.titleKey)}
                      />
                      <p className="mt-2 text-[11px] text-muted">
                        {copy.missionProgress(achievement.progress, achievement.target)}
                      </p>
                      <p className="mt-1 text-[11px] font-semibold text-gold">
                        {copy.reward(achievement.rewardXp, achievement.rewardCoins)}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-gold/20 bg-surface/70 p-4 tablet:p-6">
            <div className="mb-4">
              <h2 className="font-display text-2xl font-bold text-ivory">
                {copy.cosmeticStoreTitle}
              </h2>
              <p className="mt-1 text-xs text-muted">{copy.walletDisclosure}</p>
            </div>
            {summary.cosmetics.length === 0 ? (
              <p className="rounded-xl border border-dashed border-ivory/15 p-5 text-center text-sm text-muted">
                {copy.noCosmetics}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {summary.cosmetics.map((cosmetic) => (
                  <article
                    key={cosmetic.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-ivory/10 bg-cloth/45 p-4"
                  >
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-ivory">
                        {translated(copy.titleByKey, cosmetic.nameKey)}
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        {translated(copy.descriptionByKey, cosmetic.descriptionKey)}
                      </p>
                      <p className="mt-2 text-xs font-bold text-gold">
                        {cosmetic.priceCoins} · {copy.walletTitle}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={
                        cosmetic.owned ||
                        busyId === cosmetic.id ||
                        summary.wallet.balance < cosmetic.priceCoins
                      }
                      onClick={() => void redeemCosmetic(cosmetic.id)}
                      className="min-h-10 shrink-0 rounded-xl bg-gold px-3 py-2 text-xs font-bold text-surface hover:bg-gold/90 disabled:cursor-not-allowed disabled:bg-ivory/10 disabled:text-muted"
                    >
                      {cosmetic.owned ? copy.cosmeticOwned : copy.cosmeticRedeem}
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>

          {summary.notifications.length > 0 && (
            <section className="rounded-3xl border border-ivory/10 bg-surface/65 p-4 tablet:p-6">
              <h2 className="font-display text-xl font-bold text-ivory">
                {copy.notificationsTitle}
              </h2>
              <ul className="mt-3 space-y-2">
                {summary.notifications.map((notification) => (
                  <li
                    key={notification.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-ivory/10 bg-cloth/40 px-3 py-2"
                  >
                    <p className="text-sm text-ivory">
                      {copy.achievementUnlocked}:{' '}
                      {translated(copy.titleByKey, String(notification.payload['titleKey'] ?? ''))}
                    </p>
                    {notification.readAt ? (
                      <span className="text-[10px] text-muted">✓</span>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === notification.id}
                        onClick={() => void readNotification(notification.id)}
                        className="min-h-9 rounded-lg px-2 text-xs font-semibold text-gold hover:bg-gold/10"
                      >
                        {messagesEsAr.social.markRead}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}
