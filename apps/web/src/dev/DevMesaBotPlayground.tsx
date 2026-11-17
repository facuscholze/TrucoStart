import {
  applyAction,
  AR_CORTO_15_V1,
  AR_STANDARD_V1,
  chooseBotAction,
  createGame,
  createSeededRng,
  formatDomainEvent,
  type GameState,
  type PlayerSeat,
  viewFor,
} from '@truco/engine';
import {
  QUICK_CHAT_PHRASES,
  type QuickChatPhraseId,
  type RoomSeatInfo,
  type TableStatus,
  type WsCallBid,
  type WsCallFamily,
  type WsRespondAnswer,
} from '@truco/shared';
import { Badge, type SpanishCardId } from '@truco/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GameTableView, type WsConnectionStatus } from '../features/mesa/GameTableView.js';
import type { MatchEndedSummary } from '../features/mesa/MatchResultModal.js';
import type { ServerPlayerView } from '../features/mesa/mesa-view-model.js';
import { messagesEsAr } from '../i18n/messages.es-AR.js';

export type DevMesaScene = 'midhand' | 'calls' | 'reconnecting' | 'result';

const DEV_SEATS_1V1: PlayerSeat[] = [
  { seat: 0, team: 0, playerId: 'dev-human-0' },
  { seat: 1, team: 1, playerId: 'dev-bot-1' },
];

const DEV_SEATS_2V2: PlayerSeat[] = [
  { seat: 0, team: 0, playerId: 'dev-human-0' },
  { seat: 1, team: 1, playerId: 'dev-bot-1' },
  { seat: 2, team: 0, playerId: 'dev-bot-2' },
  { seat: 3, team: 1, playerId: 'dev-bot-3' },
];

const DEV_NICKNAMES = ['FacuCordoba', 'Bot Gaucho', 'Compa Sur', 'Bot Malevo'] as const;
const DEMO_SEED_COMMITMENT = '8f4b2e91c7d3a05612e4b908f17c3a65d9024e7b81c6a53f20d19e847b6c5a12';
const DEMO_SEED_REVEAL = '3a79c15e04d28b6f91e3a74c58d02f196b4e8c72a10d5f93e284b761c09d3e4f';
const FIXED_DEMO_NOW_MS = 1_800_000_000_000;

function buildSceneState(
  mode: '1v1' | '2v2',
  use30Flor: boolean,
  scene: DevMesaScene,
  seed = 20261113,
): {
  readonly state: GameState;
  readonly feed: string[];
  readonly bubbles: Map<number, string>;
} {
  const ruleset = use30Flor ? AR_STANDARD_V1 : AR_CORTO_15_V1;
  const players = mode === '2v2' ? DEV_SEATS_2V2 : DEV_SEATS_1V1;
  let state = createGame(ruleset, players, createSeededRng(seed));
  const feed: string[] = [];
  const bubbles = new Map<number, string>();

  const stepWith = (act: Parameters<typeof applyAction>[1]) => {
    const res = applyAction(state, act);
    if (res.ok) {
      state = res.value.state;
      for (const ev of res.value.events) {
        feed.push(formatDomainEvent(ev));
      }
    }
  };

  if (scene === 'result') {
    // Jugar partida determinística completa entre bots hasta alcanzar el resultado final
    let guard = 0;
    while (state.status !== 'FINISHED' && guard < 400) {
      guard += 1;
      const active = state.hand.activeSeat;
      const botAct = chooseBotAction(viewFor(state, active));
      stepWith(botAct);
    }
    return { state, feed: feed.slice(-8), bubbles };
  }

  // Para mitad de mano / cantos / reconexión dejamos una baza iniciada y el turno o canto en escena realista
  if (scene === 'midhand' || scene === 'reconnecting') {
    const firstCard = state.hand.remainingHandsBySeat[0]?.[0];
    if (firstCard) stepWith({ type: 'PLAY_CARD', seat: 0, cardId: firstCard.id });
    const rivalSeat = 1;
    const rivalCard = state.hand.remainingHandsBySeat[rivalSeat]?.[0];
    if (rivalCard && state.hand.activeSeat === rivalSeat) {
      stepWith({ type: 'PLAY_CARD', seat: rivalSeat, cardId: rivalCard.id });
    }
    if (mode === '2v2') {
      while (state.status === 'IN_PROGRESS' && state.hand.activeSeat !== 0) {
        stepWith(chooseBotAction(viewFor(state, state.hand.activeSeat)));
      }
    }
    bubbles.set(1, '¡Cantalo si te animás!');
    state = {
      ...state,
      scoresByTeam: use30Flor ? { 0: 18, 1: 14 } : { 0: 9, 1: 7 },
    };
  } else if (scene === 'calls') {
    // Escena al inicio de 1.ª baza con mano propia habilitada para Envido, Real Envido, Falta Envido y Truco
    bubbles.set(1, '¡Buenas!');
    state = {
      ...state,
      scoresByTeam: use30Flor ? { 0: 21, 1: 19 } : { 0: 11, 1: 8 },
    };
  }

  return { state, feed, bubbles };
}

function readInitialSceneFromUrl(): DevMesaScene {
  if (typeof window === 'undefined') return 'midhand';
  const raw = new URLSearchParams(window.location.search).get('scene');
  if (raw === 'calls' || raw === 'reconnecting' || raw === 'result' || raw === 'midhand') {
    return raw;
  }
  return 'midhand';
}

function readInitialModeFromUrl(): '1v1' | '2v2' {
  if (typeof window === 'undefined') return '2v2';
  const raw = new URLSearchParams(window.location.search).get('mode');
  return raw === '1v1' ? '1v1' : '2v2';
}

export default function DevMesaBotPlayground({ onExitHome }: { readonly onExitHome: () => void }) {
  const [mode, setMode] = useState<'1v1' | '2v2'>(readInitialModeFromUrl);
  const [use30Flor, setUse30Flor] = useState<boolean>(true);
  const [scene, setScene] = useState<DevMesaScene>(readInitialSceneFromUrl);
  const [seedCounter, setSeedCounter] = useState<number>(20261113);

  const initialBundle = useMemo(
    () => buildSceneState(mode, use30Flor, scene, seedCounter),
    [mode, scene, seedCounter, use30Flor],
  );

  const [gameState, setGameState] = useState<GameState>(initialBundle.state);
  const [feed, setFeed] = useState<string[]>(initialBundle.feed);
  const [bubbles, setBubbles] = useState<Map<number, string>>(initialBundle.bubbles);
  const [simulatedReconnecting, setSimulatedReconnecting] = useState<boolean>(
    scene === 'reconnecting',
  );

  useEffect(() => {
    setGameState(initialBundle.state);
    setFeed(initialBundle.feed);
    setBubbles(initialBundle.bubbles);
    setSimulatedReconnecting(scene === 'reconnecting');
  }, [initialBundle, scene]);

  // Avance automático de los asientos bot cuando la partida está en curso y no está pausada en reconexión simulada
  useEffect(() => {
    if (simulatedReconnecting || gameState.status !== 'IN_PROGRESS') return;
    if (gameState.hand.activeSeat === 0) return;

    const timer = setTimeout(() => {
      const botSeat = gameState.hand.activeSeat;
      const botAction = chooseBotAction(viewFor(gameState, botSeat));
      const res = applyAction(gameState, botAction);
      if (!res.ok) return;

      setGameState(res.value.state);
      const newLines = res.value.events.map((e) => formatDomainEvent(e));
      if (newLines.length > 0) {
        setFeed((prev) => [...prev.slice(-16), ...newLines]);
      }

      if (
        botAction.type === 'CALL_ENVIDO' ||
        botAction.type === 'CALL_TRUCO' ||
        botAction.type === 'CALL_FLOR'
      ) {
        const label = messagesEsAr.calls.bids[botAction.bid]?.label ?? botAction.bid;
        setBubbles((prev) => new Map(prev).set(botSeat, label));
      }
    }, 320);

    return () => clearTimeout(timer);
  }, [gameState, simulatedReconnecting]);

  const dispatchHumanAction = useCallback(
    (action: Parameters<typeof applyAction>[1]) => {
      const res = applyAction(gameState, action);
      if (!res.ok) return;
      setGameState(res.value.state);
      const lines = res.value.events.map((e) => formatDomainEvent(e));
      if (lines.length > 0) {
        setFeed((prev) => [...prev.slice(-16), ...lines]);
      }
    },
    [gameState],
  );

  const playerView = useMemo(
    () => viewFor(gameState, 0) as unknown as ServerPlayerView,
    [gameState],
  );

  const seatsInfo: RoomSeatInfo[] = gameState.seats.map((s) => ({
    seat: s.seat,
    team: s.team,
    userId: s.playerId ?? `seat-${s.seat}`,
    nickname: DEV_NICKNAMES[s.seat] ?? `Bot ${s.seat}`,
    ready: gameState.status !== 'FINISHED',
    connected: !(simulatedReconnecting && s.seat === 1),
    isBot: true,
  }));

  const connectionStatus: WsConnectionStatus = simulatedReconnecting ? 'reconnecting' : 'connected';
  const tableStatus: TableStatus = gameState.status === 'FINISHED' ? 'FINISHED' : 'IN_GAME';

  const matchEnded: MatchEndedSummary | null =
    gameState.status === 'FINISHED'
      ? {
          matchId: '019a7e40-0000-7000-8000-000000de9999',
          winnerTeam: gameState.winnerTeam ?? 0,
          usScore: gameState.scoresByTeam[0] ?? 0,
          themScore: gameState.scoresByTeam[1] ?? 0,
          targetScore: gameState.ruleset.targetScore,
          reason: 'TARGET_SCORE_REACHED',
          seedCommitment: DEMO_SEED_COMMITMENT,
          seedReveal: DEMO_SEED_REVEAL,
        }
      : null;

  const graceMap = useMemo(() => {
    const m = new Map<number, number>();
    if (simulatedReconnecting) {
      m.set(1, FIXED_DEMO_NOW_MS + 32_000);
    }
    return m;
  }, [simulatedReconnecting]);

  return (
    <div className="min-h-screen bg-surface text-ivory flex flex-col">
      {/* Cinta superior compacta explícita de ruta exclusiva de desarrollo */}
      <div
        role="region"
        aria-label={messagesEsAr.devMesa.ribbonBadge}
        className="bg-elevated border-b border-gold/50 px-3 py-1.5 flex items-center justify-between gap-2 flex-wrap text-xs"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="danger">{messagesEsAr.devMesa.ribbonBadge}</Badge>
          <span className="hidden tablet:inline text-muted truncate">
            {messagesEsAr.devMesa.ribbonText}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setMode((m) => (m === '1v1' ? '2v2' : '1v1'))}
            className="min-h-[44px] px-2.5 rounded-lg bg-surface border border-ivory/20 font-semibold text-ivory"
          >
            {mode === '1v1' ? messagesEsAr.devMesa.mode1v1 : messagesEsAr.devMesa.mode2v2}
          </button>
          <button
            type="button"
            onClick={() => setUse30Flor((f) => !f)}
            className="min-h-[44px] px-2.5 rounded-lg bg-surface border border-ivory/20 font-semibold text-ivory"
          >
            {use30Flor ? messagesEsAr.devMesa.ruleset30Flor : messagesEsAr.devMesa.ruleset15}
          </button>
          <select
            aria-label="Seleccionar escena de inspección"
            value={scene}
            onChange={(e) => setScene(e.target.value as DevMesaScene)}
            className="min-h-[44px] px-2.5 rounded-lg bg-surface border border-gold/40 font-semibold text-gold"
          >
            <option value="midhand">{messagesEsAr.devMesa.sceneMidhand}</option>
            <option value="calls">{messagesEsAr.devMesa.sceneCalls}</option>
            <option value="reconnecting">{messagesEsAr.devMesa.sceneReconnecting}</option>
            <option value="result">{messagesEsAr.devMesa.sceneResult}</option>
          </select>
        </div>
      </div>

      <GameTableView
        roomId="dev-mesa-local"
        joinCode="DEVBOT"
        connectionStatus={connectionStatus}
        tableStatus={tableStatus}
        seats={seatsInfo}
        myUserId="dev-human-0"
        view={playerView}
        seedCommitment={DEMO_SEED_COMMITMENT}
        turnDeadlineMs={FIXED_DEMO_NOW_MS + (simulatedReconnecting ? 8_000 : 19_000)}
        isTurnWarning={simulatedReconnecting}
        peerGraceDeadlinesBySeat={graceMap}
        speechBubblesBySeat={bubbles}
        eventFeed={feed}
        matchEnded={matchEnded}
        toastMessage={null}
        defaultCallTrayOpen={scene === 'calls'}
        nowMsOverride={FIXED_DEMO_NOW_MS}
        onRetryConnect={() => setSimulatedReconnecting(false)}
        onMarkReady={() => undefined}
        onPlayCard={(cardId: SpanishCardId) =>
          dispatchHumanAction({ type: 'PLAY_CARD', seat: 0, cardId })
        }
        onCallBid={(bid: WsCallBid) => {
          if (bid === 'ENVIDO' || bid === 'REAL_ENVIDO' || bid === 'FALTA_ENVIDO') {
            dispatchHumanAction({ type: 'CALL_ENVIDO', seat: 0, bid });
          } else if (bid === 'TRUCO' || bid === 'RETRUCO' || bid === 'VALE_CUATRO') {
            dispatchHumanAction({ type: 'CALL_TRUCO', seat: 0, bid });
          } else {
            dispatchHumanAction({ type: 'CALL_FLOR', seat: 0, bid });
          }
          setBubbles((prev) => new Map(prev).set(0, messagesEsAr.calls.bids[bid].label));
        }}
        onRespondCall={(family: WsCallFamily, answer: WsRespondAnswer) => {
          if (family === 'ENVIDO' && (answer === 'QUIERO' || answer === 'NO_QUIERO')) {
            dispatchHumanAction({ type: 'RESPOND_ENVIDO', seat: 0, decision: answer });
          } else if (family === 'TRUCO' && (answer === 'QUIERO' || answer === 'NO_QUIERO')) {
            dispatchHumanAction({ type: 'RESPOND_TRUCO', seat: 0, decision: answer });
          } else if (family === 'FLOR' && (answer === 'CON_FLOR_QUIERO' || answer === 'ACHICO')) {
            dispatchHumanAction({ type: 'RESPOND_FLOR', seat: 0, decision: answer });
          }
        }}
        onFoldHand={() => dispatchHumanAction({ type: 'FOLD_HAND', seat: 0 })}
        onSendSignal={(signalId: string) =>
          dispatchHumanAction({ type: 'SEND_SIGNAL', seat: 0, signalId })
        }
        onSendQuickChat={(phraseId: QuickChatPhraseId) => {
          const phrase = QUICK_CHAT_PHRASES.find((p) => p.id === phraseId);
          if (phrase) {
            setBubbles((prev) => new Map(prev).set(0, phrase.text));
          }
        }}
        onRequestRematch={() => {
          setScene('midhand');
          setSeedCounter((s) => s + 1);
        }}
        onLeaveTable={onExitHome}
      />
    </div>
  );
}
