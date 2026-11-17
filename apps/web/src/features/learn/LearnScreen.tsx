import {
  applyAction,
  AR_CORTO_15_V1,
  type Card as EngineCard,
  chooseBotAction,
  createGame,
  createGameWithHands,
  createSeededRng,
  type PlayerSeat as EnginePlayerSeat,
  formatDomainEvent,
  type GameState,
  viewFor,
} from '@truco/engine';
import type { WsCallBid, WsCallFamily, WsRespondAnswer } from '@truco/shared';
import { Badge, CallButton, Card, PlayerSeat } from '@truco/ui';
import { useEffect, useMemo, useState } from 'react';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import { playTableSoundCue } from '../../lib/sound-fx.js';
import { CallTray } from '../mesa/CallTray.js';
import { TutorialScreen } from './TutorialScreen.js';
import { groupServerLegalActions, type ServerPlayerView } from '../mesa/mesa-view-model.js';

type LearnTab = 'rules' | 'hierarchy' | 'signals' | 'tutorial';

const TUTORIAL_PLAYERS: EnginePlayerSeat[] = [
  { seat: 0, team: 0, playerId: 'alumno' },
  { seat: 1, team: 1, playerId: 'bot-gaucho' },
];

function mkCard(rank: EngineCard['rank'], suit: EngineCard['suit']): EngineCard {
  return { id: `${rank}-${suit}`, rank, suit };
}

function createCuratedTutorialMatch(): GameState {
  return createGameWithHands({
    ruleset: AR_CORTO_15_V1,
    players: TUTORIAL_PLAYERS,
    handsBySeat: {
      0: [mkCard(1, 'espadas'), mkCard(7, 'oros'), mkCard(6, 'oros')],
      1: [mkCard(3, 'copas'), mkCard(12, 'bastos'), mkCard(5, 'copas')],
    },
    manoSeat: 0,
    rng: createSeededRng(101),
  });
}

export function LearnScreen() {
  const [tab, setTab] = useState<LearnTab>('rules');
  const [previewSignal, setPreviewSignal] = useState<string>('cejas_arriba');

  const [seedCounter, setSeedCounter] = useState<number>(1);
  const [match, setMatch] = useState<GameState>(() => createCuratedTutorialMatch());
  const [feedNote, setFeedNote] = useState<string>(
    'Tenés 33 de Envido (7 y 6 de oros) y además el Ancho de espadas. ¡Probá cantar Envido antes de bajar tu primera carta!',
  );

  useEffect(() => {
    if (tab !== 'tutorial' || match.status !== 'IN_PROGRESS') return;
    if (match.hand.activeSeat === 0) return;

    const timer = setTimeout(() => {
      const botSeat = match.hand.activeSeat;
      const action = chooseBotAction(viewFor(match, botSeat));
      const res = applyAction(match, action);
      if (res.ok) {
        setMatch(res.value.state);
        const lastEv = res.value.events[res.value.events.length - 1];
        if (lastEv) setFeedNote(formatDomainEvent(lastEv));
      }
    }, 520);

    return () => clearTimeout(timer);
  }, [match, tab]);

  const myView = useMemo(() => viewFor(match, 0) as unknown as ServerPlayerView, [match]);
  const groupedCalls = useMemo(() => groupServerLegalActions(myView.legalActions), [myView]);
  const canPlayCard = groupedCalls.playableCardIds.size > 0;
  const isMyTurn = myView.hand.activeSeat === 0 && match.status === 'IN_PROGRESS';

  const computeCoachTip = (): string => {
    if (match.status === 'FINISHED') {
      return '¡Partida de práctica terminada! Podés repartir una mano nueva cuantas veces quieras.';
    }
    if (groupedCalls.pendingResponses.length > 0) {
      return 'Gaucho Bot te cantó una apuesta. Revisá tus cartas y elegí Quiero, No quiero o subí la apuesta.';
    }
    if (myView.hand.currentRoundIndex === 0 && groupedCalls.envidoBids.length > 0) {
      return 'Primera baza: si sumás 27 o más de Envido con dos cartas del mismo palo, ¡conviene cantar Envido antes de bajar carta!';
    }
    if (groupedCalls.trucoBids.length > 0 && canPlayCard) {
      return 'Es tu turno: podés tocar una carta de tu mano para jugarla al paño o cantar Truco para subir los puntos en disputa.';
    }
    return feedNote;
  };

  const dispatchTutorialBid = (bid: WsCallBid) => {
    playTableSoundCue('call');
    const action =
      bid === 'ENVIDO' || bid === 'REAL_ENVIDO' || bid === 'FALTA_ENVIDO'
        ? ({ type: 'CALL_ENVIDO', seat: 0, bid } as const)
        : bid === 'TRUCO' || bid === 'RETRUCO' || bid === 'VALE_CUATRO'
          ? ({ type: 'CALL_TRUCO', seat: 0, bid } as const)
          : ({ type: 'CALL_FLOR', seat: 0, bid } as const);
    const res = applyAction(match, action);
    if (res.ok) {
      setMatch(res.value.state);
      const lastEv = res.value.events[res.value.events.length - 1];
      if (lastEv) setFeedNote(formatDomainEvent(lastEv));
    }
  };

  const dispatchTutorialRespond = (family: WsCallFamily, answer: WsRespondAnswer) => {
    playTableSoundCue('call');
    const action =
      family === 'ENVIDO' && (answer === 'QUIERO' || answer === 'NO_QUIERO')
        ? ({ type: 'RESPOND_ENVIDO', seat: 0, decision: answer } as const)
        : family === 'TRUCO' && (answer === 'QUIERO' || answer === 'NO_QUIERO')
          ? ({ type: 'RESPOND_TRUCO', seat: 0, decision: answer } as const)
          : family === 'FLOR' && (answer === 'CON_FLOR_QUIERO' || answer === 'ACHICO')
            ? ({ type: 'RESPOND_FLOR', seat: 0, decision: answer } as const)
            : null;
    if (!action) return;
    const res = applyAction(match, action);
    if (res.ok) {
      setMatch(res.value.state);
      const lastEv = res.value.events[res.value.events.length - 1];
      if (lastEv) setFeedNote(formatDomainEvent(lastEv));
    }
  };

  const handleDealNewPracticeHand = () => {
    const nextSeed = seedCounter + 1;
    setSeedCounter(nextSeed);
    const fresh = createGame(
      AR_CORTO_15_V1,
      TUTORIAL_PLAYERS,
      createSeededRng(500 + nextSeed * 37),
    );
    setMatch(fresh);
    setFeedNote('Nueva mano repartida. Mirá tu tanto de Envido y el poder de tus tres cartas.');
  };

  const allTrickPlays = [
    ...myView.hand.completedRounds.flatMap((r) =>
      r.plays.map((p) => ({ key: `c-${r.roundIndex}-${p.seat}`, seat: p.seat, card: p.card })),
    ),
    ...myView.hand.currentRoundPlays.map((p) => ({
      key: `cur-${p.seat}`,
      seat: p.seat,
      card: p.card,
    })),
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-display text-2xl tablet:text-3xl font-bold text-ivory">
          {messagesEsAr.learn.title}
        </h1>
        <p className="text-sm text-muted max-w-2xl">{messagesEsAr.learn.subtitle}</p>
      </header>

      <div role="tablist" aria-label={messagesEsAr.learn.title} className="flex gap-2 flex-wrap">
        {(
          [
            ['rules', messagesEsAr.learn.tabRules],
            ['hierarchy', messagesEsAr.learn.tabHierarchy],
            ['signals', messagesEsAr.learn.tabSignals],
            ['tutorial', messagesEsAr.learn.tabTutorial],
          ] as const
        ).map(([id, label]) => {
          const active = tab === id;
          return (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={`min-h-[44px] px-4 rounded-xl text-sm font-bold transition-colors ${
                active
                  ? 'bg-elevated text-gold border border-gold/55'
                  : 'bg-surface text-muted hover:text-ivory border border-ivory/20'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Pestaña 1: Reglas */}
      {tab === 'rules' && (
        <div className="grid grid-cols-1 tablet:grid-cols-2 gap-4">
          {messagesEsAr.learn.rulesBlocks.map((block) => (
            <article
              key={block.title}
              className="rounded-2xl bg-surface border border-ivory/20 p-5 space-y-2 shadow-lg"
            >
              <h2 className="font-display text-lg font-bold text-gold">{block.title}</h2>
              <p className="text-sm text-ivory/90 leading-relaxed">{block.body}</p>
            </article>
          ))}
        </div>
      )}

      {/* Pestaña 2: Escala completa de las 40 cartas */}
      {tab === 'hierarchy' && (
        <section className="rounded-2xl bg-surface border border-ivory/20 p-4 tablet:p-6 space-y-3">
          <p className="text-sm text-muted">{messagesEsAr.learn.hierarchyIntro}</p>
          {messagesEsAr.learn.hierarchyTiers.map((tier, idx) => (
            <div
              key={tier.label}
              className="rounded-xl bg-elevated border border-ivory/15 p-3.5 flex items-center justify-between gap-4 flex-wrap"
            >
              <div className="space-y-1 max-w-md">
                <div className="flex items-center gap-2">
                  <Badge variant={idx < 4 ? 'gold' : 'neutral'}>{`#${idx + 1}`}</Badge>
                  <h2 className="font-display text-base font-bold text-ivory">{tier.label}</h2>
                </div>
                <p className="text-xs text-muted">{tier.note}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {tier.cards.map((c) => (
                  <Card key={`${c.rank}-${c.suit}`} rank={c.rank} suit={c.suit} size="sm" />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Pestaña 3: Catálogo de señas tradicionales */}
      {tab === 'signals' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-surface border border-gold/40 p-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="space-y-1 max-w-lg">
              <span className="text-xs font-bold uppercase tracking-wider text-muted">
                Vista previa en mesa de parejas (2v2)
              </span>
              <p className="text-xs text-ivory/90">{messagesEsAr.learn.signalsIntro}</p>
            </div>
            <PlayerSeat
              seat={2}
              nickname="Compañero"
              team={0}
              connected
              remainingCards={3}
              speechBubbleText={`Seña: ${messagesEsAr.calls.signals[previewSignal] ?? previewSignal}`}
              compact
            />
          </div>

          <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3.5">
            {messagesEsAr.learn.signalsGuide.map((item) => {
              const selected = previewSignal === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPreviewSignal(item.id)}
                  className={`min-h-[44px] text-left rounded-2xl p-4 border transition-colors space-y-1.5 ${
                    selected
                      ? 'bg-elevated border-gold/65'
                      : 'bg-surface border-ivory/20 hover:border-ivory/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="font-display text-base font-bold text-gold">
                      {item.gesture}
                    </strong>
                    <Badge variant="sky">{item.meaning}</Badge>
                  </div>
                  <p className="text-xs text-muted">
                    {messagesEsAr.calls.signals[item.id] ?? item.id}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Pestaña 4: Tutorial interactivo guiado contra Gaucho Bot */}
      {tab === 'tutorial' && (
        <div className="mb-5">
          <TutorialScreen syncWithAccount />
        </div>
      )}

      {tab === 'tutorial' && (
        <section className="rounded-2xl bg-surface border border-gold/40 p-4 tablet:p-6 space-y-5 shadow-xl">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1 max-w-xl">
              <h2 className="font-display text-xl font-bold text-ivory">
                {messagesEsAr.learn.tutorialTitle}
              </h2>
              <p className="text-xs tablet:text-sm text-muted">
                {messagesEsAr.learn.tutorialSubtitle}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="gold">
                {`Vos ${myView.scoresByTeam[0] ?? 0} - ${myView.scoresByTeam[1] ?? 0} Bot`}
              </Badge>
              <CallButton tone="neutral" onClick={handleDealNewPracticeHand}>
                {messagesEsAr.learn.resetTutorialCta}
              </CallButton>
            </div>
          </div>

          <div
            role="status"
            aria-live="polite"
            className="rounded-xl bg-elevated border border-sky/50 p-3.5 space-y-1"
          >
            <div className="text-xs font-bold uppercase tracking-wider text-sky">
              {messagesEsAr.learn.coachHeading}
            </div>
            <p className="text-sm text-ivory leading-relaxed">{computeCoachTip()}</p>
          </div>

          <div className="rounded-2xl bg-cloth border border-gold/30 p-4 space-y-4">
            <div className="flex items-center justify-between text-xs font-semibold text-muted">
              <span>{messagesEsAr.mesa.handCounter(myView.hand.handNumber)}</span>
              <span>{isMyTurn ? messagesEsAr.mesa.yourTurnBanner : 'Gaucho Bot pensando…'}</span>
            </div>

            <div className="min-h-[110px] rounded-xl bg-surface/55 border border-ivory/15 p-3 flex items-center justify-center gap-6 flex-wrap">
              {allTrickPlays.map((p) => (
                <div key={p.key} className="flex flex-col items-center gap-1">
                  <Card rank={p.card.rank} suit={p.card.suit} size="sm" />
                  <span className="text-[11px] font-bold text-ivory">
                    {p.seat === 0 ? 'Vos' : 'Bot'}
                  </span>
                </div>
              ))}
              {allTrickPlays.length === 0 && (
                <span className="text-xs text-muted">{messagesEsAr.mesa.waitingFirstCard}</span>
              )}
            </div>

            <div className="flex items-center justify-center gap-3 flex-wrap pt-1">
              {myView.hand.myRemainingCards.map((card) => {
                const playable = groupedCalls.playableCardIds.has(card.id);
                return (
                  <Card
                    key={card.id}
                    rank={card.rank}
                    suit={card.suit}
                    size="md"
                    playable={playable}
                    disabled={!playable}
                    onPlay={() => {
                      playTableSoundCue('card');
                      const step = applyAction(match, {
                        type: 'PLAY_CARD',
                        seat: 0,
                        cardId: card.id,
                      });
                      if (step.ok) {
                        setMatch(step.value.state);
                        const lastEv = step.value.events[step.value.events.length - 1];
                        if (lastEv) setFeedNote(formatDomainEvent(lastEv));
                      }
                    }}
                  />
                );
              })}
            </div>

            <div className="max-w-xl mx-auto">
              <CallTray
                groupedCalls={groupedCalls}
                inlineMode
                onCallBid={dispatchTutorialBid}
                onRespondCall={dispatchTutorialRespond}
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
