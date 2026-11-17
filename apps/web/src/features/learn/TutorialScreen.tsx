import {
  type Action,
  applyAction,
  createGameWithHands,
  createSeededRng,
  type CardId,
  type GameState,
  getCardById,
  AR_STANDARD_V1,
  viewFor,
} from '@truco/engine';
import {
  type TutorialLesson,
  TUTORIAL_LESSONS,
  type TutorialProgressResponse,
  type TutorialLessonId,
} from '@truco/shared';
import { Badge, CallButton } from '@truco/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import { getTutorialProgressRequest, putTutorialProgressRequest } from '../../lib/api-client.js';

/** Convierte un código de acción (`PLAY_CARD:1-espadas`) en una acción del motor. */
export function parseTutorialActionCode(code: string, seat: number): Action | null {
  const [type, value] = code.split(':');
  switch (type) {
    case 'PLAY_CARD':
      return value ? { type: 'PLAY_CARD', seat, cardId: value as CardId } : null;
    case 'CALL_ENVIDO':
      return value ? { type: 'CALL_ENVIDO', seat, bid: value as never } : null;
    case 'CALL_TRUCO':
      return value ? { type: 'CALL_TRUCO', seat, bid: value as never } : null;
    case 'CALL_FLOR':
      return value ? { type: 'CALL_FLOR', seat, bid: value as never } : null;
    case 'RESPOND_ENVIDO':
      return value ? { type: 'RESPOND_ENVIDO', seat, decision: value as never } : null;
    case 'RESPOND_TRUCO':
      return value ? { type: 'RESPOND_TRUCO', seat, decision: value as never } : null;
    case 'RESPOND_FLOR':
      return value ? { type: 'RESPOND_FLOR', seat, decision: value as never } : null;
    case 'SEND_SIGNAL':
      return value ? { type: 'SEND_SIGNAL', seat, signalId: value } : null;
    case 'FOLD_HAND':
      return { type: 'FOLD_HAND', seat };
    default:
      return null;
  }
}

function actionCode(action: Action): string {
  if (action.type === 'PLAY_CARD') return `PLAY_CARD:${action.cardId}`;
  if (action.type === 'CALL_ENVIDO') return `CALL_ENVIDO:${action.bid}`;
  if (action.type === 'CALL_TRUCO') return `CALL_TRUCO:${action.bid}`;
  if (action.type === 'CALL_FLOR') return `CALL_FLOR:${action.bid}`;
  if (action.type === 'RESPOND_ENVIDO') return `RESPOND_ENVIDO:${action.decision}`;
  if (action.type === 'RESPOND_TRUCO') return `RESPOND_TRUCO:${action.decision}`;
  if (action.type === 'RESPOND_FLOR') return `RESPOND_FLOR:${action.decision}`;
  if (action.type === 'SEND_SIGNAL') return `SEND_SIGNAL:${action.signalId}`;
  return action.type;
}

export function buildLessonState(lesson: TutorialLesson): {
  state: GameState;
  error: string | null;
} {
  const seats = (lesson.mode === '2v2' ? [0, 1, 2, 3] : [0, 1]).map((seat) => ({
    seat,
    team: seat % 2,
  }));
  const handsBySeat: Record<number, ReturnType<typeof getCardById>[]> = {};
  for (const [seatKey, ids] of Object.entries(lesson.deal.hands)) {
    handsBySeat[Number(seatKey)] = ids.map((id) => getCardById(id as never)!);
  }
  let state = createGameWithHands({
    ruleset: AR_STANDARD_V1,
    players: seats,
    handsBySeat: handsBySeat as never,
    manoSeat: lesson.deal.manoSeat,
    rng: createSeededRng(20260101),
  } as never);

  for (const step of lesson.deal.prelude) {
    const action = parseTutorialActionCode(step.code, step.seat);
    if (!action) continue;
    const res = applyAction(state, action);
    if (!res.ok) return { state, error: `Guion inválido: ${step.code} (${res.error.code})` };
    state = res.value.state;
  }
  return { state, error: null };
}

export interface TutorialScreenProps {
  /** `true` cuando hay una sesión (invitado o cuenta) con la que guardar el avance. */
  readonly syncWithAccount?: boolean;
}

/**
 * Tutorial interactivo (M6): lecciones guiadas con repartos fijos y motor puro en el cliente.
 * El avance se guarda en la cuenta (`/v1/me/tutorial`); si falla, la lección sigue disponible.
 */
export function TutorialScreen({ syncWithAccount = true }: TutorialScreenProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [solved, setSolved] = useState<boolean>(false);

  const lesson = TUTORIAL_LESSONS[selectedIndex]!;
  const initial = useMemo(() => buildLessonState(lesson), [lesson]);
  const [state, setState] = useState<GameState>(initial.state);

  useEffect(() => {
    setState(initial.state);
    setFeedback(null);
    setSolved(false);
  }, [initial]);

  const [accountSync, setAccountSync] = useState<boolean>(syncWithAccount);

  useEffect(() => {
    if (!syncWithAccount) return;
    let cancelled = false;
    void getTutorialProgressRequest()
      .then((progress: TutorialProgressResponse) => {
        if (!cancelled) setCompleted(progress.completedLessons);
      })
      .catch(() => {
        if (!cancelled) setAccountSync(false);
      });
    return () => {
      cancelled = true;
    };
  }, [syncWithAccount]);

  const persist = useCallback(
    (next: string[]) => {
      setCompleted(next);
      if (!accountSync) return;
      void putTutorialProgressRequest({ completedLessons: next as TutorialLessonId[] }).catch(
        () => undefined,
      );
    },
    [accountSync],
  );

  const handleAction = (action: Action) => {
    const code = actionCode(action);
    if (lesson.deal.correctActions.includes(code)) {
      const res = applyAction(state, action);
      if (res.ok) setState(res.value.state);
      setSolved(true);
      setFeedback({ tone: 'ok', text: messagesEsAr.tutorial.successFeedback });
      if (!completed.includes(lesson.id)) persist([...completed, lesson.id]);
      return;
    }
    setFeedback({ tone: 'error', text: lesson.gentleCorrection });
  };

  const view = viewFor(state, 0);
  const myCards = view.hand.myRemainingCards;
  const legal = view.legalActions;
  const playableCards = legal.filter((a) => a.type === 'PLAY_CARD');
  const calls = legal.filter(
    (a) =>
      a.type === 'CALL_ENVIDO' ||
      a.type === 'CALL_TRUCO' ||
      a.type === 'CALL_FLOR' ||
      a.type === 'SEND_SIGNAL',
  );
  const responses = legal.filter(
    (a) => a.type === 'RESPOND_ENVIDO' || a.type === 'RESPOND_TRUCO' || a.type === 'RESPOND_FLOR',
  );

  const goToLesson = (index: number) => {
    setSelectedIndex(index);
  };

  const nextLesson = () => {
    if (selectedIndex + 1 < TUTORIAL_LESSONS.length) goToLesson(selectedIndex + 1);
  };

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="font-display text-2xl tablet:text-3xl font-bold text-ivory">
          {messagesEsAr.tutorial.title}
        </h1>
        <p className="text-sm text-muted max-w-2xl">{messagesEsAr.tutorial.subtitle}</p>
      </header>

      <div className="grid grid-cols-1 desktop:grid-cols-12 gap-5 items-start">
        <nav
          aria-label={messagesEsAr.tutorial.lessonListAria}
          className="desktop:col-span-4 space-y-2"
        >
          {TUTORIAL_LESSONS.map((item, index) => {
            const isDone = completed.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => goToLesson(index)}
                aria-current={index === selectedIndex ? 'step' : undefined}
                className={`w-full min-h-[44px] text-left rounded-xl border px-3.5 py-2.5 flex items-center justify-between gap-2 ${
                  index === selectedIndex
                    ? 'border-gold bg-elevated'
                    : 'border-ivory/20 bg-surface hover:border-gold/50'
                }`}
              >
                <span className="text-sm font-bold text-ivory">
                  {index + 1}. {item.title}
                </span>
                {isDone ? (
                  <Badge variant="success">{messagesEsAr.tutorial.lessonDoneBadge}</Badge>
                ) : null}
              </button>
            );
          })}
        </nav>

        <section
          aria-labelledby="tutorial-lesson-heading"
          className="desktop:col-span-8 rounded-2xl bg-surface border border-gold/35 p-5 space-y-4 shadow-lg"
        >
          <div className="space-y-2">
            <h2 id="tutorial-lesson-heading" className="font-display text-xl font-bold text-gold">
              {lesson.title}
            </h2>
            <p className="text-sm text-ivory" data-testid="tutorial-objective">
              <strong className="text-gold">{messagesEsAr.tutorial.objectiveLabel}:</strong>{' '}
              {lesson.objective}
            </p>
            <ol className="list-decimal list-inside space-y-1 text-sm text-muted">
              {lesson.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="rounded-xl bg-cloth/40 border border-ivory/15 p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide font-bold text-muted">
              {messagesEsAr.tutorial.yourHandLabel}
            </p>
            <div className="flex gap-2 flex-wrap">
              {myCards.map((card) => {
                const canPlay = playableCards.some(
                  (a) => a.type === 'PLAY_CARD' && a.cardId === card.id,
                );
                return (
                  <button
                    key={card.id}
                    type="button"
                    disabled={!canPlay || solved}
                    onClick={() =>
                      handleAction({ type: 'PLAY_CARD', seat: 0, cardId: card.id } as Action)
                    }
                    data-testid={`tutorial-card-${card.id}`}
                    className={`min-h-[44px] px-3 rounded-lg border font-bold text-sm ${
                      canPlay && !solved
                        ? 'bg-elevated border-gold text-ivory'
                        : 'bg-elevated/50 border-ivory/15 text-muted'
                    }`}
                  >
                    {card.rank} de {card.suit}
                  </button>
                );
              })}
            </div>

            {(calls.length > 0 || responses.length > 0) && !solved && (
              <div className="flex flex-wrap gap-2 pt-1">
                {[...responses, ...calls].map((action) => (
                  <button
                    key={actionCode(action)}
                    type="button"
                    onClick={() => handleAction(action)}
                    data-testid={`tutorial-action-${actionCode(action)}`}
                    className="min-h-[44px] px-3 rounded-lg bg-sky text-surface font-bold text-sm"
                  >
                    {actionLabel(action)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {feedback && (
            <p
              role="status"
              data-testid="tutorial-feedback"
              className={`text-sm font-bold ${feedback.tone === 'ok' ? 'text-success' : 'text-danger'}`}
            >
              {feedback.text}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {solved && selectedIndex + 1 < TUTORIAL_LESSONS.length && (
              <CallButton tone="accept" onClick={nextLesson}>
                {messagesEsAr.tutorial.nextLessonCta}
              </CallButton>
            )}
            <CallButton
              tone="neutral"
              onClick={() => {
                setSolved(true);
                setFeedback({ tone: 'ok', text: messagesEsAr.tutorial.skippedFeedback });
                if (!completed.includes(lesson.id)) persist([...completed, lesson.id]);
              }}
            >
              {messagesEsAr.tutorial.skipCta}
            </CallButton>
          </div>

          <p className="text-xs text-muted">
            {messagesEsAr.tutorial.progressLabel(completed.length, TUTORIAL_LESSONS.length)}
            {!accountSync ? ` · ${messagesEsAr.tutorial.guestProgressNote}` : ''}
          </p>
        </section>
      </div>
    </div>
  );
}

function actionLabel(action: Action): string {
  switch (action.type) {
    case 'CALL_ENVIDO':
      return `${messagesEsAr.tutorial.callPrefix} ${action.bid}`;
    case 'CALL_TRUCO':
      return `${messagesEsAr.tutorial.callPrefix} ${action.bid}`;
    case 'CALL_FLOR':
      return `${messagesEsAr.tutorial.callPrefix} ${action.bid}`;
    case 'RESPOND_ENVIDO':
    case 'RESPOND_TRUCO':
    case 'RESPOND_FLOR':
      return `${messagesEsAr.tutorial.respondPrefix} ${action.decision}`;
    case 'SEND_SIGNAL':
      return messagesEsAr.tutorial.signalPrefix;
    default:
      return action.type;
  }
}
