import type { PlayerRatingResponse, PublicUserProfile, UserStatsResponse } from '@truco/shared';
import { Avatar, Badge, CallButton } from '@truco/ui';
import { useEffect, useState } from 'react';
import { ReportButton } from '../moderation/ReportButton.js';
import { RatingProfilesCard } from '../ratings/RatingProfilesCard.js';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import {
  getPlayerRatingsRequest,
  getPublicUserProfileRequest,
  getUserStatsRequest,
} from '../../lib/api-client.js';

export interface PlayerProfileScreenProps {
  readonly userId: string;
  readonly currentUserId: string | null;
  readonly onNavigate: (path: string) => void;
}

/**
 * Perfil público de otro jugador (`/jugador/:userId`).
 * Sólo muestra datos públicos: apodo, nivel, bio y estadísticas agregadas.
 */
export function PlayerProfileScreen({
  userId,
  currentUserId,
  onNavigate,
}: PlayerProfileScreenProps) {
  const [profile, setProfile] = useState<PublicUserProfile | null>(null);
  const [stats, setStats] = useState<UserStatsResponse | null>(null);
  const [ratingProfiles, setRatingProfiles] = useState<PlayerRatingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStats(null);
    setRatingProfiles(null);
    const statsRequest = getUserStatsRequest(userId).catch(() => null);
    const ratingRequest = getPlayerRatingsRequest(userId).catch(() => null);
    void Promise.all([getPublicUserProfileRequest(userId), statsRequest, ratingRequest])
      .then(([nextProfile, nextStats, nextRatings]) => {
        if (cancelled) return;
        setProfile(nextProfile);
        setStats(nextStats);
        setRatingProfiles(nextRatings);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : messagesEsAr.publicProfile.loadError,
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loading) {
    return <p className="p-6 text-sm text-ivory/70">{messagesEsAr.publicProfile.loading}</p>;
  }

  if (error || !profile) {
    return (
      <div className="mx-auto max-w-xl space-y-3 p-6">
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger-strong"
        >
          {error ?? messagesEsAr.publicProfile.notFound}
        </p>
        <CallButton tone="neutral" onClick={() => onNavigate('/lobby')}>
          {messagesEsAr.publicProfile.returnLobby}
        </CallButton>
      </div>
    );
  }

  const isSelf = currentUserId !== null && currentUserId === profile.id;

  return (
    <main
      className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6"
      aria-labelledby="player-profile-heading"
    >
      <section className="rounded-2xl border border-sky/25 bg-cloth/35 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar nickname={profile.nickname} sizePx={56} />
            <div>
              <h1
                id="player-profile-heading"
                className="font-display text-2xl font-bold text-ivory"
              >
                {profile.nickname}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant="sky">{messagesEsAr.publicProfile.level(profile.level)}</Badge>
                {profile.isGuest && <Badge variant="gold">{messagesEsAr.profile.guestBadge}</Badge>}
                <span className="text-[11px] text-ivory/50">
                  {messagesEsAr.publicProfile.joinedSince(
                    new Date(profile.createdAt).toLocaleDateString('es-AR'),
                  )}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isSelf && (
              <ReportButton
                targets={[{ userId: profile.id, nickname: profile.nickname }]}
                myUserId={currentUserId}
                label={messagesEsAr.publicProfile.report}
              />
            )}
            <CallButton tone="neutral" onClick={() => onNavigate('/lobby')}>
              {messagesEsAr.publicProfile.back}
            </CallButton>
          </div>
        </div>

        {profile.bio.length > 0 && <p className="mt-3 text-sm text-ivory/75">{profile.bio}</p>}
      </section>

      {stats ? (
        <>
          <section className="grid grid-cols-2 gap-3 rounded-2xl border border-ivory/15 bg-surface/60 p-4 sm:grid-cols-4">
            {[
              { label: messagesEsAr.profile.statPlayed, value: stats.matchesPlayed },
              { label: messagesEsAr.profile.statWins, value: stats.wins },
              { label: messagesEsAr.profile.statLosses, value: stats.losses },
              { label: messagesEsAr.profile.statAbandons, value: stats.abandons },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-[11px] uppercase tracking-wider text-ivory/50">{item.label}</p>
                <p className="font-display text-2xl font-bold text-ivory">{item.value}</p>
              </div>
            ))}
          </section>
          <section className="space-y-2 rounded-2xl border border-ivory/15 bg-surface/60 p-4">
            <h2 className="font-display text-base font-bold text-ivory">
              {messagesEsAr.profile.modeStatsTitle}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(['1v1', '2v2'] as const).map((mode) => {
                const modeStats = stats.byMode[mode];
                return (
                  <article
                    key={mode}
                    className="space-y-2 rounded-xl border border-ivory/10 bg-elevated p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display font-bold text-gold">{mode}</h3>
                      <Badge variant="neutral">
                        {messagesEsAr.profile.modeMatchesSummary(
                          modeStats.matchesPlayed,
                          Math.round(modeStats.winRate * 100),
                        )}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted">
                      {messagesEsAr.profile.streakLabel}:{' '}
                      <strong className="text-ivory">{modeStats.currentStreak}</strong>
                    </p>
                    <div className="flex flex-wrap gap-x-4 text-[11px] text-muted">
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
          </section>
        </>
      ) : (
        <p className="rounded-xl border border-ivory/15 bg-surface/60 p-4 text-xs text-muted">
          {messagesEsAr.publicProfile.statsUnavailable}
        </p>
      )}

      <RatingProfilesCard data={ratingProfiles} onNavigate={onNavigate} />

      <p className="text-[11px] leading-relaxed text-ivory/45">
        {messagesEsAr.publicProfile.privacyNotice}
      </p>
    </main>
  );
}
