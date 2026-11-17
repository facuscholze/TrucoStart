import type { PublicUserProfile, UserStatsResponse } from '@truco/shared';
import { Avatar, Badge, CallButton } from '@truco/ui';
import { useEffect, useState } from 'react';
import { ReportButton } from '../moderation/ReportButton.js';
import { getPublicUserProfileRequest, getUserStatsRequest } from '../../lib/api-client.js';

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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all([getPublicUserProfileRequest(userId), getUserStatsRequest(userId)])
      .then(([nextProfile, nextStats]) => {
        if (cancelled) return;
        setProfile(nextProfile);
        setStats(nextStats);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'No pudimos cargar el perfil.');
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
    return <p className="p-6 text-sm text-ivory/70">Cargando perfil…</p>;
  }

  if (error || !profile) {
    return (
      <div className="mx-auto max-w-xl space-y-3 p-6">
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
        >
          {error ?? 'Jugador no encontrado.'}
        </p>
        <CallButton tone="neutral" onClick={() => onNavigate('/lobby')}>
          Volver al lobby
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
                <Badge variant="sky">Nivel {profile.level}</Badge>
                {profile.isGuest && <Badge variant="gold">Invitado</Badge>}
                <span className="text-[11px] text-ivory/50">
                  En la mesa desde {new Date(profile.createdAt).toLocaleDateString('es-AR')}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isSelf && (
              <ReportButton
                targets={[{ userId: profile.id, nickname: profile.nickname }]}
                myUserId={currentUserId}
                label="Reportar a este jugador"
              />
            )}
            <CallButton tone="neutral" onClick={() => onNavigate('/lobby')}>
              Volver
            </CallButton>
          </div>
        </div>

        {profile.bio.length > 0 && <p className="mt-3 text-sm text-ivory/75">{profile.bio}</p>}
      </section>

      {stats && (
        <section className="grid grid-cols-2 gap-3 rounded-2xl border border-ivory/15 bg-surface/60 p-4 sm:grid-cols-4">
          {[
            { label: 'Partidas', value: stats.matchesPlayed },
            { label: 'Victorias', value: stats.wins },
            { label: 'Derrotas', value: stats.losses },
            { label: 'Abandonos', value: stats.abandons },
          ].map((item) => (
            <div key={item.label}>
              <p className="text-[11px] uppercase tracking-wider text-ivory/50">{item.label}</p>
              <p className="font-display text-2xl font-bold text-ivory">{item.value}</p>
            </div>
          ))}
        </section>
      )}

      <p className="text-[11px] leading-relaxed text-ivory/45">
        Este perfil es público y no incluye datos personales. Si el comportamiento en la mesa no fue
        el esperado, podés reportarlo y el equipo de moderación revisa la partida.
      </p>
    </main>
  );
}
