import type {
  QuickChatPhraseId,
  RoomSeatInfo,
  TableStatus,
  WsCallBid,
  WsCallFamily,
  WsEnvelope,
  WsRespondAnswer,
} from '@truco/shared';
import type { SpanishCardId } from '@truco/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io as createSocketIoClient, type Socket } from 'socket.io-client';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import { getMyModerationStateRequest } from '../../lib/api-client.js';
import {
  decodeSessionIdFromWsTicket,
  ensureGuestOrActiveSession,
  mintSingleUseWsTicket,
} from '../../lib/api-client.js';
import type { GameTableSessionProps, WsConnectionStatus } from './GameTableView.js';
import type { MatchEndedSummary } from './MatchResultModal.js';
import type { ServerPlayerView } from './mesa-view-model.js';

function makeEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface UseLiveGameRoomOptions {
  readonly roomId: string;
  readonly joinCode?: string | null;
  readonly wsBaseUrl?: string;
}

export function useLiveGameRoom({
  roomId,
  joinCode = null,
  wsBaseUrl,
}: UseLiveGameRoomOptions): Omit<GameTableSessionProps, 'onLeaveTable'> {
  const [connectionStatus, setConnectionStatus] = useState<WsConnectionStatus>('connecting');
  const [tableStatus, setTableStatus] = useState<TableStatus>('WAITING');
  const [seats, setSeats] = useState<readonly RoomSeatInfo[]>([]);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [view, setView] = useState<ServerPlayerView | null>(null);
  const [seedCommitment, setSeedCommitment] = useState<string | null>(null);
  const [turnDeadlineMs, setTurnDeadlineMs] = useState<number | null>(null);
  const [isTurnWarning, setIsTurnWarning] = useState<boolean>(false);
  const [peerGraceDeadlinesBySeat, setPeerGraceDeadlinesBySeat] = useState<Map<number, number>>(
    () => new Map(),
  );
  const [speechBubblesBySeat, setSpeechBubblesBySeat] = useState<Map<number, string>>(
    () => new Map(),
  );
  const [eventFeed, setEventFeed] = useState<string[]>([]);
  const [matchEnded, setMatchEnded] = useState<MatchEndedSummary | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [mutedUntil, setMutedUntil] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [practiceHint, setPracticeHint] = useState<{
    explanation: string;
    suggestedAction: string;
  } | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const lastSeqRef = useRef<number>(0);
  const sessionIdRef = useRef<string | null>(null);
  const hasJoinedOnceRef = useRef<boolean>(false);
  const myTeamRef = useRef<number | null>(null);

  const pushBubble = useCallback((seat: number, text: string) => {
    setSpeechBubblesBySeat((prev) => {
      const next = new Map(prev);
      next.set(seat, text);
      return next;
    });
    setTimeout(() => {
      setSpeechBubblesBySeat((prev) => {
        if (prev.get(seat) !== text) return prev;
        const next = new Map(prev);
        next.delete(seat);
        return next;
      });
    }, 3200);
  }, []);

  const appendFeed = useCallback((line: string) => {
    setEventFeed((prev) => [...prev.slice(-24), line]);
  }, []);

  const sendEnvelope = useCallback((type: string, payload: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;
    socket.emit('envelope', {
      eventId: makeEventId(),
      ts: Date.now(),
      type,
      payload,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let socket: Socket | null = null;

    const boot = async () => {
      try {
        const me = await ensureGuestOrActiveSession();
        if (cancelled) return;
        setMyUserId(me.id);

        socket = createSocketIoClient(wsBaseUrl ?? '/', {
          path: '/socket.io',
          transports: ['websocket'],
          reconnection: true,
          reconnectionDelay: 600,
          reconnectionDelayMax: 3500,
          // CRÍTICO: pide un ws-ticket single-use NUEVO en la conexión inicial y en CADA reconexión
          auth: (cb) => {
            void mintSingleUseWsTicket()
              .then((res) => {
                sessionIdRef.current = decodeSessionIdFromWsTicket(res.ticket);
                cb({ token: res.ticket });
              })
              .catch(() => {
                cb({});
              });
          },
        });
        socketRef.current = socket;

        socket.on('connect', () => {
          if (cancelled) return;
          setConnectionStatus('connected');
          if (hasJoinedOnceRef.current && sessionIdRef.current && lastSeqRef.current > 0) {
            socket?.emit('envelope', {
              eventId: makeEventId(),
              ts: Date.now(),
              type: 'game.rejoin',
              payload: {
                roomId,
                sessionId: sessionIdRef.current,
                lastSeq: lastSeqRef.current,
              },
            });
          } else {
            hasJoinedOnceRef.current = true;
            socket?.emit('envelope', {
              eventId: makeEventId(),
              ts: Date.now(),
              type: 'table.join',
              payload: { roomId },
            });
          }
        });

        socket.io.on('reconnect_attempt', () => {
          if (!cancelled) setConnectionStatus('reconnecting');
        });

        socket.on('disconnect', () => {
          if (!cancelled) setConnectionStatus('reconnecting');
        });

        socket.on('connect_error', () => {
          if (!cancelled) setConnectionStatus('reconnecting');
        });

        socket.on('envelope', (env: WsEnvelope) => {
          if (cancelled) return;
          if (typeof env.seq === 'number' && env.seq > lastSeqRef.current) {
            lastSeqRef.current = env.seq;
          }

          const p = env.payload;
          switch (env.type) {
            case 'table.state': {
              setTableStatus(p['status'] as TableStatus);
              setSeats((p['seats'] as RoomSeatInfo[]) ?? []);
              setMatchId(typeof p['matchId'] === 'string' ? p['matchId'] : null);
              break;
            }
            case 'game.started': {
              setTableStatus('IN_GAME');
              setMatchEnded(null);
              setEventFeed([]);
              setSeats((p['seats'] as RoomSeatInfo[]) ?? []);
              setSeedCommitment((p['seedCommitment'] as string | undefined) ?? null);
              if (typeof p['yourSeat'] === 'number') {
                myTeamRef.current = p['yourSeat'] % 2;
              }
              break;
            }
            case 'practice.hint': {
              setPracticeHint({
                explanation: String(p['explanation'] ?? ''),
                suggestedAction: String(p['suggestedAction'] ?? ''),
              });
              break;
            }
            case 'game.dealt': {
              const nextView = p['view'] as unknown as ServerPlayerView;
              myTeamRef.current = nextView.myTeam;
              setView(nextView);
              appendFeed(messagesEsAr.mesa.handCounter(nextView.hand.handNumber));
              break;
            }
            case 'game.turn': {
              setTurnDeadlineMs((p['deadline'] as number | undefined) ?? null);
              setIsTurnWarning(Boolean(p['isWarning']));
              if (p['view']) {
                const nextView = p['view'] as unknown as ServerPlayerView;
                myTeamRef.current = nextView.myTeam;
                setView(nextView);
              }
              break;
            }
            case 'game.resync': {
              setSeedCommitment((p['seedCommitment'] as string | null) ?? null);
              setTurnDeadlineMs((p['turnDeadline'] as number | null) ?? null);
              if (p['view']) {
                const nextView = p['view'] as unknown as ServerPlayerView;
                myTeamRef.current = nextView.myTeam;
                setView(nextView);
              }
              break;
            }
            case 'game.callMade': {
              const bid = p['bid'] as WsCallBid;
              const seat = Number(p['seat'] ?? 0);
              const label = messagesEsAr.calls.bids[bid]?.label ?? bid;
              pushBubble(seat, label);
              appendFeed(`Asiento ${seat + 1}: ${label}`);
              break;
            }
            case 'game.callResolved': {
              const accepted = Boolean(p['accepted']);
              const responder = p['responderSeat'] as number | null;
              const label = accepted
                ? messagesEsAr.calls.decisions.QUIERO.label
                : messagesEsAr.calls.decisions.NO_QUIERO.label;
              if (responder !== null) pushBubble(responder, label);
              appendFeed(`${p['family'] as string}: ${label} (+${String(p['pointsAwarded'])} pts)`);
              break;
            }
            case 'game.signalSent': {
              const seat = Number(p['seat'] ?? 0);
              const senderTeam = typeof p['team'] === 'number' ? p['team'] : seat % 2;
              if (myTeamRef.current === null || senderTeam !== myTeamRef.current) {
                break;
              }
              const sigId = String(p['signalId'] ?? '');
              const sigLabel = messagesEsAr.calls.signals[sigId] ?? sigId;
              pushBubble(seat, sigLabel);
              appendFeed(sigLabel);
              break;
            }
            case 'chat.quickMessage': {
              const seat = Number(p['seat'] ?? 0);
              const text = String(p['text'] ?? '');
              pushBubble(seat, text);
              appendFeed(`${String(p['nickname'] ?? '')}: ${text}`);
              break;
            }
            case 'player.disconnected': {
              const seat = Number(p['seat'] ?? 0);
              const grace = Number(p['graceDeadline'] ?? Date.now() + 45_000);
              setSeats((prev) =>
                prev.map((s) => (s.seat === seat ? { ...s, connected: false } : s)),
              );
              setPeerGraceDeadlinesBySeat((prev) => {
                const next = new Map(prev);
                next.set(seat, grace);
                return next;
              });
              break;
            }
            case 'player.reconnected': {
              const seat = Number(p['seat'] ?? 0);
              setSeats((prev) =>
                prev.map((s) => (s.seat === seat ? { ...s, connected: true } : s)),
              );
              setPeerGraceDeadlinesBySeat((prev) => {
                const next = new Map(prev);
                next.delete(seat);
                return next;
              });
              break;
            }
            case 'game.ended': {
              setTableStatus('FINISHED');
              setTurnDeadlineMs(null);
              const scores = (p['scoresByTeam'] as Record<string, number>) ?? {};
              setView((latestView) => {
                const myTeam = latestView?.myTeam ?? 0;
                const target = latestView?.ruleset.targetScore ?? 30;
                // En el truco de 6 hay dos rivales: el resumen lleva el tanteador completo de
                // los tres equipos y cuál es el mío, en vez de inventar un "ellos" único.
                const teamScores = Object.fromEntries(
                  Object.entries(scores).map(([team, score]) => [team, Number(score)]),
                );
                const otherTeam = Object.keys(scores)
                  .map(Number)
                  .filter((team) => team !== myTeam)
                  .sort((a, b) => a - b)[0];
                setMatchEnded({
                  matchId: String(p['matchId'] ?? ''),
                  winnerTeam: Number(p['winnerTeam'] ?? 0),
                  usScore: Number(scores[String(myTeam)] ?? 0),
                  themScore: Number(scores[String(otherTeam)] ?? 0),
                  teamScores,
                  myTeam,
                  targetScore: target,
                  reason: String(p['reason'] ?? 'TARGET_SCORE_REACHED'),
                  seedCommitment: String(p['seedCommitment'] ?? ''),
                  seedReveal: String(p['seedReveal'] ?? ''),
                });
                return latestView;
              });
              setSeats((prev) => prev.map((s) => ({ ...s, ready: false })));
              break;
            }
            case 'error': {
              setToastMessage(String(p['message'] ?? 'Acción rechazada por el servidor'));
              break;
            }
          }
        });
      } catch (err) {
        if (!cancelled) {
          setConnectionStatus('disconnected');
          setToastMessage(
            err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
          );
        }
      }
    };

    const handleBrowserOffline = () => {
      if (cancelled) return;
      setConnectionStatus('reconnecting');
      socket?.disconnect();
    };

    const handleBrowserOnline = () => {
      if (cancelled) return;
      socket?.connect();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('offline', handleBrowserOffline);
      window.addEventListener('online', handleBrowserOnline);
    }

    void boot();

    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('offline', handleBrowserOffline);
        window.removeEventListener('online', handleBrowserOnline);
      }
      socket?.disconnect();
      socketRef.current = null;
    };
  }, [appendFeed, pushBubble, roomId, wsBaseUrl]);

  useEffect(() => {
    let cancelled = false;
    void getMyModerationStateRequest()
      .then((state) => {
        if (!cancelled) setMutedUntil(state.mutedUntil);
      })
      .catch(() => {
        // Sin sesión o sin red: el servidor de juego sigue siendo la autoridad.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    roomId,
    joinCode,
    connectionStatus,
    tableStatus,
    seats,
    myUserId,
    view,
    seedCommitment,
    turnDeadlineMs,
    isTurnWarning,
    peerGraceDeadlinesBySeat,
    speechBubblesBySeat,
    eventFeed,
    matchEnded,
    matchId,
    mutedUntil,
    toastMessage,
    practiceHint,
    onDismissHint: () => setPracticeHint(null),
    onRequestHint: () => sendEnvelope('practice.hint', { roomId }),
    onDismissToast: () => setToastMessage(null),
    onRetryConnect: () => {
      socketRef.current?.connect();
    },
    onMarkReady: (ready: boolean) => sendEnvelope('table.ready', { roomId, ready }),
    onPlayCard: (cardId: SpanishCardId) => sendEnvelope('game.playCard', { roomId, cardId }),
    onCallBid: (bid: WsCallBid) => sendEnvelope('game.call', { roomId, type: bid }),
    onRespondCall: (family: WsCallFamily, answer: WsRespondAnswer) =>
      sendEnvelope('game.respond', { roomId, call: family, answer }),
    onFoldHand: () => sendEnvelope('game.foldHand', { roomId }),
    onSendSignal: (signalId: string) => sendEnvelope('game.signal', { roomId, signalId }),
    onSendQuickChat: (phraseId: QuickChatPhraseId) =>
      sendEnvelope('chat.quick', { roomId, phraseId }),
    onRequestRematch: () => sendEnvelope('table.ready', { roomId, ready: true }),
  };
}
