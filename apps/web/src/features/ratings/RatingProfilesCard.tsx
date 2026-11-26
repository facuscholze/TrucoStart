import type { PlayerRatingResponse } from '@truco/shared';
import { Badge, CallButton } from '@truco/ui';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';

export function RatingProfilesCard({
  data,
  onNavigate,
}: {
  readonly data: PlayerRatingResponse | null;
  readonly onNavigate: (path: string) => void;
}) {
  if (!data) return null;
  const seasonEnd = new Date(data.ratings[0]?.seasonEndsAt ?? '').toLocaleDateString('es-AR');

  return (
    <section className="rounded-2xl border border-gold/30 bg-surface p-5 shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-gold">
            {messagesEsAr.profile.ratingSectionTitle}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {data.ratings[0]?.seasonLabel} · {messagesEsAr.profile.ratingSeasonEnd(seasonEnd)}
          </p>
        </div>
        <CallButton tone="neutral" onClick={() => onNavigate('/ranking')}>
          {messagesEsAr.profile.ratingViewRankings}
        </CallButton>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        {messagesEsAr.profile.ratingSourceNote}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 tablet:grid-cols-2">
        {data.ratings.map((rating) => (
          <article key={rating.mode} className="rounded-xl border border-ivory/15 bg-elevated p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-bold text-ivory">{rating.mode}</h3>
                <p className="mt-1 text-[11px] text-muted">
                  {messagesEsAr.profile.ratingRecord(rating.matchesPlayed, rating.opponentsCount)}
                </p>
              </div>
              <Badge variant={rating.qualifies ? 'gold' : 'neutral'}>
                {rating.qualifies && rating.position !== null
                  ? messagesEsAr.profile.ratingRank(rating.position)
                  : messagesEsAr.profile.ratingDivision}
              </Badge>
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-x-4 gap-y-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {messagesEsAr.rankings.rating}
                </p>
                <p className="font-display text-3xl font-bold tabular-nums text-gold">
                  {Math.round(rating.rating)}
                </p>
              </div>
              <div className="pb-1 text-xs text-muted">
                {messagesEsAr.profile.ratingDivision}:{' '}
                <strong className="text-ivory">{rating.division}</strong>
              </div>
            </div>
            {!rating.qualifies && (
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                {messagesEsAr.profile.ratingUnranked}
              </p>
            )}
            {rating.qualifies && rating.position === null && (
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                {messagesEsAr.rankings.privacyNote}
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
