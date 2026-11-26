import type { GameMode, LeaderboardResponse, RankingPeriod } from '@truco/shared';
import { Badge, CallButton } from '@truco/ui';
import { useEffect, useState } from 'react';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import { getLeaderboardRequest, WebApiError } from '../../lib/api-client.js';

function localDate(value: string): string {
  return new Date(value).toLocaleDateString('es-AR');
}

function scoreLabel(score: number, period: RankingPeriod): string {
  if (period === 'GLOBAL') return String(Math.round(score));
  const rounded = Math.round(score);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function PlayerProfileButton({
  userId,
  nickname,
  onNavigate,
}: {
  readonly userId: string;
  readonly nickname: string;
  readonly onNavigate: (path: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${messagesEsAr.rankings.openProfile}: ${nickname}`}
      onClick={() => onNavigate(`/jugador/${encodeURIComponent(userId)}`)}
      className="min-w-0 truncate text-left font-semibold text-ivory underline decoration-sky/50 underline-offset-2 hover:text-sky"
    >
      {nickname}
    </button>
  );
}

export function LeaderboardScreen({ onNavigate }: { readonly onNavigate: (path: string) => void }) {
  const [mode, setMode] = useState<GameMode>('1v1');
  const [period, setPeriod] = useState<RankingPeriod>('GLOBAL');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    void getLeaderboardRequest({ mode, period, limit: 20 })
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof WebApiError ? loadError.message : messagesEsAr.rankings.loadError,
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, period]);

  const showPeriodScore = data !== null && data.period !== 'GLOBAL';

  const handleLoadMore = async () => {
    if (!data?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await getLeaderboardRequest({
        mode,
        period,
        limit: 20,
        cursor: data.nextCursor,
      });
      setData((current) =>
        current
          ? { ...current, items: [...current.items, ...next.items], nextCursor: next.nextCursor }
          : next,
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : messagesEsAr.rankings.loadError);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <main className="space-y-5" aria-labelledby="rankings-heading">
      <header className="rounded-2xl border border-gold/35 bg-surface p-5 shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Badge variant="gold">
              {data?.season.label ?? messagesEsAr.rankings.defaultSeasonLabel}
            </Badge>
            <h1 id="rankings-heading" className="mt-2 font-display text-2xl font-bold text-ivory">
              {messagesEsAr.rankings.title}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              {messagesEsAr.rankings.subtitle}
            </p>
          </div>
          <CallButton tone="neutral" onClick={() => onNavigate('/')}>
            {messagesEsAr.rankings.returnHome}
          </CallButton>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 tablet:grid-cols-2">
          <label className="space-y-1 text-xs text-muted">
            <span className="block font-semibold">{messagesEsAr.rankings.periodLabel}</span>
            <select
              className="min-h-[42px] w-full rounded-lg border border-ivory/20 bg-elevated px-3 text-sm text-ivory"
              value={period}
              onChange={(event) => setPeriod(event.target.value as RankingPeriod)}
            >
              <option value="GLOBAL">{messagesEsAr.rankings.global}</option>
              <option value="WEEKLY">{messagesEsAr.rankings.weekly}</option>
              <option value="MONTHLY">{messagesEsAr.rankings.monthly}</option>
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted">
            <span className="block font-semibold">{messagesEsAr.rankings.modeLabel}</span>
            <select
              className="min-h-[42px] w-full rounded-lg border border-ivory/20 bg-elevated px-3 text-sm text-ivory"
              value={mode}
              onChange={(event) => setMode(event.target.value as GameMode)}
            >
              <option value="1v1">{messagesEsAr.rankings.mode1v1}</option>
              <option value="2v2">{messagesEsAr.rankings.mode2v2}</option>
            </select>
          </label>
        </div>
      </header>

      {data ? (
        <section className="min-h-[4.5rem] tablet:min-h-[2.75rem] flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ivory/15 bg-surface/70 px-4 py-3 text-xs text-muted">
          <span>
            {messagesEsAr.rankings.seasonEnds(data.season.label, localDate(data.season.endsAt))}
          </span>
          <span>{messagesEsAr.rankings.resetCountdown(data.season.secondsUntilReset)}</span>
        </section>
      ) : (
        <div
          aria-hidden="true"
          className="min-h-[4.5rem] tablet:min-h-[2.75rem] rounded-xl border border-transparent px-4 py-3"
        />
      )}

      <div className="min-h-[7rem]">
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger-strong"
          >
            {error}
          </div>
        )}

        {loading ? (
          <p
            role="status"
            className="min-h-[7rem] rounded-xl border border-ivory/15 bg-surface p-8 text-center text-sm text-muted"
          >
            {messagesEsAr.rankings.loading}
          </p>
        ) : data && data.items.length === 0 ? (
          <p className="min-h-[7rem] rounded-xl border border-dashed border-ivory/20 bg-surface/60 p-8 text-center text-sm text-muted">
            {messagesEsAr.rankings.empty}
          </p>
        ) : data ? (
          <section className="overflow-hidden rounded-2xl border border-ivory/15 bg-surface shadow-lg">
            <p className="border-b border-ivory/10 px-4 py-3 text-xs text-muted">
              {messagesEsAr.rankings.privacyNote}{' '}
              {messagesEsAr.rankings.minimumQualification(
                data.minimumMatches,
                data.minimumOpponents,
              )}
            </p>

            <ol
              aria-label={messagesEsAr.rankings.title}
              className="tablet:hidden divide-y divide-ivory/10"
            >
              {data.items.map((item) => (
                <li key={item.userId} className="px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 font-display font-bold text-gold">
                      #{item.position}
                    </span>
                    <PlayerProfileButton
                      userId={item.userId}
                      nickname={item.nickname}
                      onNavigate={onNavigate}
                    />
                    <span
                      aria-label={`${messagesEsAr.rankings.rating}: ${Math.round(item.rating)}`}
                      className="shrink-0 tabular-nums text-sm text-ivory"
                    >
                      {Math.round(item.rating)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-muted">{messagesEsAr.rankings.division}</span>
                      <Badge variant="sky">{item.division}</Badge>
                    </span>
                    {showPeriodScore && (
                      <span className="text-muted">
                        {messagesEsAr.rankings.score}:{' '}
                        <strong className="tabular-nums text-gold">
                          {scoreLabel(item.score, data.period)}
                        </strong>
                      </span>
                    )}
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-ivory/10 pt-2 text-[11px]">
                    <div>
                      <dt className="text-muted">{messagesEsAr.rankings.played}</dt>
                      <dd className="tabular-nums text-ivory">{item.matchesPlayed}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">{messagesEsAr.rankings.opponents}</dt>
                      <dd className="tabular-nums text-ivory">{item.opponentsCount}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">{messagesEsAr.rankings.wins}</dt>
                      <dd className="tabular-nums text-ivory">{item.wins}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>

            <div className="hidden overflow-x-auto tablet:block">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <caption className="sr-only">{messagesEsAr.rankings.title}</caption>
                <thead className="bg-elevated text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3">
                      {messagesEsAr.rankings.position}
                    </th>
                    <th scope="col" className="px-4 py-3">
                      {messagesEsAr.rankings.playerLabel}
                    </th>
                    <th scope="col" className="px-4 py-3">
                      {messagesEsAr.rankings.rating}
                    </th>
                    <th scope="col" className="px-4 py-3">
                      {messagesEsAr.rankings.division}
                    </th>
                    {showPeriodScore && (
                      <th scope="col" className="px-4 py-3">
                        {messagesEsAr.rankings.score}
                      </th>
                    )}
                    <th scope="col" className="px-4 py-3">
                      {messagesEsAr.rankings.played}
                    </th>
                    <th scope="col" className="px-4 py-3">
                      {messagesEsAr.rankings.opponents}
                    </th>
                    <th scope="col" className="px-4 py-3">
                      {messagesEsAr.rankings.wins}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ivory/10">
                  {data.items.map((item) => (
                    <tr key={item.userId} className="hover:bg-elevated/50">
                      <td className="px-4 py-3 font-display font-bold text-gold">
                        #{item.position}
                      </td>
                      <td className="px-4 py-3">
                        <PlayerProfileButton
                          userId={item.userId}
                          nickname={item.nickname}
                          onNavigate={onNavigate}
                        />
                      </td>
                      <td className="px-4 py-3 tabular-nums text-ivory">
                        {Math.round(item.rating)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="sky">{item.division}</Badge>
                      </td>
                      {showPeriodScore && (
                        <td className="px-4 py-3 tabular-nums text-gold">
                          {scoreLabel(item.score, data.period)}
                        </td>
                      )}
                      <td className="px-4 py-3 tabular-nums text-ivory/80">{item.matchesPlayed}</td>
                      <td className="px-4 py-3 tabular-nums text-ivory/80">
                        {item.opponentsCount}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-ivory/80">{item.wins}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {data?.nextCursor && (
          <div className="text-center">
            <CallButton tone="neutral" disabled={loadingMore} onClick={() => void handleLoadMore()}>
              {messagesEsAr.rankings.nextPage}
            </CallButton>
          </div>
        )}
      </div>
    </main>
  );
}
