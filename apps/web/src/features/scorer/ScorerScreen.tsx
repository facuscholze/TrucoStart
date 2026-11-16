import { Badge, CallButton, Modal, ScoreBoard } from '@truco/ui';
import { useEffect, useState } from 'react';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import { playTableSoundCue } from '../../lib/sound-fx.js';

const SCORER_STORAGE_KEY = 'truco_offline_scorer_v1';

interface ScorerHistoryItem {
  id: string;
  team: 0 | 1;
  delta: number;
  atIso: string;
}

interface ScorerPersistedState {
  targetScore: 15 | 30;
  usName: string;
  themName: string;
  usScore: number;
  themScore: number;
  history: ScorerHistoryItem[];
}

const DEFAULT_SCORER_STATE: ScorerPersistedState = {
  targetScore: 30,
  usName: messagesEsAr.scorer.defaultUsName,
  themName: messagesEsAr.scorer.defaultThemName,
  usScore: 0,
  themScore: 0,
  history: [],
};

function loadScorerState(): ScorerPersistedState {
  if (typeof window === 'undefined') return DEFAULT_SCORER_STATE;
  try {
    const raw = window.localStorage.getItem(SCORER_STORAGE_KEY);
    if (!raw) return DEFAULT_SCORER_STATE;
    const parsed = JSON.parse(raw) as Partial<ScorerPersistedState>;
    return {
      targetScore: parsed.targetScore === 15 ? 15 : 30,
      usName:
        typeof parsed.usName === 'string' && parsed.usName.trim()
          ? parsed.usName
          : messagesEsAr.scorer.defaultUsName,
      themName:
        typeof parsed.themName === 'string' && parsed.themName.trim()
          ? parsed.themName
          : messagesEsAr.scorer.defaultThemName,
      usScore: typeof parsed.usScore === 'number' ? Math.max(0, parsed.usScore) : 0,
      themScore: typeof parsed.themScore === 'number' ? Math.max(0, parsed.themScore) : 0,
      history: Array.isArray(parsed.history) ? parsed.history.slice(0, 40) : [],
    };
  } catch {
    return DEFAULT_SCORER_STATE;
  }
}

function formatStageLabel(score: number, targetScore: 15 | 30): string {
  if (targetScore === 15) {
    return `${score} / 15`;
  }
  if (score <= 15) {
    return `${score} ${messagesEsAr.scorer.malasStage}`;
  }
  return `${score - 15} ${messagesEsAr.scorer.buenasStage} (${score})`;
}

export function ScorerScreen() {
  const [state, setState] = useState<ScorerPersistedState>(() => loadScorerState());
  const [resetModalOpen, setResetModalOpen] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(SCORER_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignorado en almacenamiento restringido
    }
  }, [state]);

  const applyDelta = (team: 0 | 1, delta: number) => {
    setState((prev) => {
      const current = team === 0 ? prev.usScore : prev.themScore;
      const nextVal = Math.max(0, Math.min(prev.targetScore, current + delta));
      const realDelta = nextVal - current;
      if (realDelta === 0) return prev;

      playTableSoundCue(nextVal >= prev.targetScore ? 'score' : 'card');

      const entry: ScorerHistoryItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        team,
        delta: realDelta,
        atIso: new Date().toISOString(),
      };

      return {
        ...prev,
        usScore: team === 0 ? nextVal : prev.usScore,
        themScore: team === 1 ? nextVal : prev.themScore,
        history: [entry, ...prev.history].slice(0, 40),
      };
    });
  };

  const handleUndo = () => {
    setState((prev) => {
      const [latest, ...rest] = prev.history;
      if (!latest) return prev;
      return {
        ...prev,
        usScore: latest.team === 0 ? Math.max(0, prev.usScore - latest.delta) : prev.usScore,
        themScore: latest.team === 1 ? Math.max(0, prev.themScore - latest.delta) : prev.themScore,
        history: rest,
      };
    });
  };

  const handleConfirmReset = () => {
    setState((prev) => ({
      ...prev,
      usScore: 0,
      themScore: 0,
      history: [],
    }));
    setResetModalOpen(false);
  };

  const winnerName =
    state.usScore >= state.targetScore
      ? state.usName
      : state.themScore >= state.targetScore
        ? state.themName
        : null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display text-2xl tablet:text-3xl font-bold text-ivory">
              {messagesEsAr.scorer.title}
            </h1>
            <Badge variant="success">{messagesEsAr.scorer.offlineReadyBadge}</Badge>
          </div>
          <p className="text-sm text-muted max-w-2xl">{messagesEsAr.scorer.subtitle}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            aria-pressed={state.targetScore === 15}
            onClick={() =>
              setState((prev) => ({
                ...prev,
                targetScore: 15,
                usScore: Math.min(15, prev.usScore),
                themScore: Math.min(15, prev.themScore),
              }))
            }
            className={`min-h-[44px] px-3.5 rounded-xl text-xs font-bold border ${
              state.targetScore === 15
                ? 'bg-gold text-surface border-gold'
                : 'bg-surface text-ivory border-ivory/25'
            }`}
          >
            {messagesEsAr.scorer.target15Cta}
          </button>
          <button
            type="button"
            aria-pressed={state.targetScore === 30}
            onClick={() => setState((prev) => ({ ...prev, targetScore: 30 }))}
            className={`min-h-[44px] px-3.5 rounded-xl text-xs font-bold border ${
              state.targetScore === 30
                ? 'bg-gold text-surface border-gold'
                : 'bg-surface text-ivory border-ivory/25'
            }`}
          >
            {messagesEsAr.scorer.target30Cta}
          </button>
        </div>
      </header>

      {winnerName && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-2xl bg-surface border-2 border-gold p-4 flex items-center justify-between gap-4 flex-wrap shadow-xl"
        >
          <strong className="font-display text-xl font-bold text-gold">
            {messagesEsAr.scorer.winnerBanner(winnerName, state.targetScore)}
          </strong>
          <CallButton tone="accept" onClick={() => setResetModalOpen(true)}>
            {messagesEsAr.scorer.resetOpenCta}
          </CallButton>
        </div>
      )}

      {/* Pizarra visual con fósforos */}
      <section className="rounded-2xl bg-surface border border-gold/40 p-4 tablet:p-6 space-y-5 shadow-xl">
        <div className="flex justify-center">
          <ScoreBoard
            usLabel={state.usName}
            themLabel={state.themName}
            usScore={state.usScore}
            themScore={state.themScore}
            targetScore={state.targetScore}
          />
        </div>

        {/* Columnas táctiles por equipo */}
        <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4">
          {(
            [
              {
                team: 0 as const,
                name: state.usName,
                score: state.usScore,
                label: messagesEsAr.scorer.usNameAria,
                onChangeName: (v: string) => setState((p) => ({ ...p, usName: v })),
              },
              {
                team: 1 as const,
                name: state.themName,
                score: state.themScore,
                label: messagesEsAr.scorer.themNameAria,
                onChangeName: (v: string) => setState((p) => ({ ...p, themName: v })),
              },
            ] as const
          ).map((col) => (
            <div
              key={col.team}
              className="rounded-2xl bg-elevated border border-ivory/20 p-4 space-y-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <input
                  type="text"
                  maxLength={20}
                  value={col.name}
                  aria-label={col.label}
                  onChange={(e) => col.onChangeName(e.target.value)}
                  className="min-h-[44px] w-full min-w-0 flex-1 rounded-xl bg-surface border border-ivory/25 px-3 font-display text-lg font-bold text-ivory"
                />
                <span className="shrink-0">
                  <Badge variant={col.team === 0 ? 'gold' : 'sky'}>
                    {formatStageLabel(col.score, state.targetScore)}
                  </Badge>
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <CallButton tone="accept" onClick={() => applyDelta(col.team, 1)}>
                  {messagesEsAr.scorer.plus1Label}
                </CallButton>
                <CallButton
                  tone="decline"
                  disabled={col.score === 0}
                  onClick={() => applyDelta(col.team, -1)}
                >
                  {messagesEsAr.scorer.minus1Label}
                </CallButton>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => applyDelta(col.team, 2)}
                  className="min-h-[44px] rounded-xl bg-surface border border-gold/40 px-2 text-xs font-bold text-gold hover:bg-surface/80"
                >
                  +2
                </button>
                <button
                  type="button"
                  onClick={() => applyDelta(col.team, 3)}
                  className="min-h-[44px] rounded-xl bg-surface border border-sky/40 px-2 text-xs font-bold text-sky hover:bg-surface/80"
                >
                  +3
                </button>
                <button
                  type="button"
                  onClick={() => applyDelta(col.team, 4)}
                  className="min-h-[44px] rounded-xl bg-surface border border-ivory/30 px-2 text-xs font-bold text-ivory hover:bg-surface/80"
                >
                  +4
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap pt-2 border-t border-ivory/15">
          <CallButton tone="neutral" disabled={state.history.length === 0} onClick={handleUndo}>
            {messagesEsAr.scorer.undoCta}
          </CallButton>
          <CallButton tone="decline" onClick={() => setResetModalOpen(true)}>
            {messagesEsAr.scorer.resetOpenCta}
          </CallButton>
        </div>
      </section>

      {/* Historial de anotaciones */}
      <section className="rounded-2xl bg-surface border border-ivory/20 p-5 space-y-3">
        <h2 className="font-display text-base font-bold text-ivory">
          {messagesEsAr.scorer.historyHeading}
        </h2>
        {state.history.length === 0 ? (
          <p className="text-xs text-muted">{messagesEsAr.scorer.emptyHistoryText}</p>
        ) : (
          <ul className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            {state.history.map((item) => {
              const teamName = item.team === 0 ? state.usName : state.themName;
              const sign = item.delta > 0 ? `+${item.delta}` : String(item.delta);
              return (
                <li
                  key={item.id}
                  className="rounded-lg bg-elevated/80 border border-ivory/10 px-3 py-2 flex items-center justify-between text-xs"
                >
                  <span className="font-semibold text-ivory">{teamName}</span>
                  <span className="font-mono font-bold text-gold">{sign}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Modal
        open={resetModalOpen}
        title={messagesEsAr.scorer.resetConfirmTitle}
        onClose={() => setResetModalOpen(false)}
        closeLabel={messagesEsAr.scorer.resetCancelCta}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">{messagesEsAr.scorer.resetConfirmBody}</p>
          <div className="flex justify-end gap-2">
            <CallButton tone="neutral" onClick={() => setResetModalOpen(false)}>
              {messagesEsAr.scorer.resetCancelCta}
            </CallButton>
            <CallButton tone="decline" onClick={handleConfirmReset}>
              {messagesEsAr.scorer.resetConfirmCta}
            </CallButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
