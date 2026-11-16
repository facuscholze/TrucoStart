import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import {
  ClientEventTypeSchema,
  ClientMessageSchema,
  DEFAULT_APP_NAME,
  type HealthResponse,
  type RoomProvisionSpec,
  verifyWsAuthTicket,
  type WsAuthTicketClaims,
  type WsEnvelope,
  WsEnvelopeSchema,
} from '@truco/shared';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import {
  type MatchLifecyclePublisher,
  NoopMatchLifecyclePublisher,
} from './events/match-lifecycle-publisher.js';
import { tryHandleInternalProvisioningRoute } from './http/internal-provisioning-handler.js';
import { RoomManager } from './rooms/room-manager.js';
import { WsConnectionRateLimiter, type WsRateLimiterConfig } from './security/rate-limiter.js';
import type { GameStore } from './store/game-store.interface.js';
import { InMemoryGameStore } from './store/in-memory-game-store.js';

const DEFAULT_DEV_SECRET = 'dev-only-placeholder-secret-minimum-32-chars!!';

export interface GameServerOptions {
  readonly appName?: string;
  readonly corsOrigins?: string[];
  readonly serverId?: string;
  readonly store?: GameStore;
  readonly lifecyclePublisher?: MatchLifecyclePublisher;
  readonly sessionSecret?: string;
  readonly internalSecret?: string;
  readonly seedEncryptionKey?: string;
  readonly allowAdHocRooms?: boolean;
  readonly defaultTurnTimeoutMs?: number;
  readonly reconnectGraceMs?: number;
  readonly ownerLeaseTtlMs?: number;
  readonly internalRpcMaxSkewMs?: number;
  readonly rateLimiter?: WsRateLimiterConfig;
  readonly nowFn?: () => number;
}

export interface GameServerInstance {
  readonly httpServer: HttpServer;
  readonly io: SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    AuthenticatedSocketData
  >;
  readonly roomManager: RoomManager;
  readonly store: GameStore;
  provisionRoom(spec: RoomProvisionSpec): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
  listen(port: number, host?: string): Promise<number>;
  close(opts?: { simulateCrash?: boolean }): Promise<void>;
}

interface ClientToServerEvents {
  envelope: (rawMessage: unknown) => void;
}

interface ServerToClientEvents {
  envelope: (message: WsEnvelope) => void;
}

interface AuthenticatedSocketData {
  claims: WsAuthTicketClaims;
}

function extractHandshakeToken(socket: Socket): string | null {
  const authToken = socket.handshake.auth?.['token'];
  if (typeof authToken === 'string' && authToken.length > 0) {
    return authToken;
  }
  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  return null;
}

export function createGameServer(options: GameServerOptions = {}): GameServerInstance {
  const appName = options.appName ?? DEFAULT_APP_NAME;
  const sessionSecret = options.sessionSecret ?? DEFAULT_DEV_SECRET;
  const internalSecret = options.internalSecret ?? sessionSecret;
  const seedEncryptionKey = options.seedEncryptionKey ?? DEFAULT_DEV_SECRET;
  const store = options.store ?? new InMemoryGameStore(options.nowFn);
  const lifecyclePublisher = options.lifecyclePublisher ?? new NoopMatchLifecyclePublisher();
  const nowFn = options.nowFn ?? Date.now;

  const roomManager = new RoomManager({
    store,
    seedEncryptionKey,
    lifecyclePublisher,
    ...(options.serverId !== undefined ? { serverId: options.serverId } : {}),
    ...(options.allowAdHocRooms !== undefined ? { allowAdHocRooms: options.allowAdHocRooms } : {}),
    ...(options.defaultTurnTimeoutMs !== undefined
      ? { defaultTurnTimeoutMs: options.defaultTurnTimeoutMs }
      : {}),
    ...(options.reconnectGraceMs !== undefined
      ? { reconnectGraceMs: options.reconnectGraceMs }
      : {}),
    ...(options.ownerLeaseTtlMs !== undefined ? { ownerLeaseTtlMs: options.ownerLeaseTtlMs } : {}),
    nowFn,
  });

  const rateLimiter = new WsConnectionRateLimiter(options.rateLimiter);

  const httpServer = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const body: HealthResponse = {
        status: 'ok',
        service: 'game-server',
        appName,
        timestamp: new Date().toISOString(),
      };
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
      return;
    }

    void tryHandleInternalProvisioningRoute({
      req,
      res,
      internalSecret,
      roomManager,
      store,
      nowFn,
      ...(options.internalRpcMaxSkewMs !== undefined
        ? { maxSkewMs: options.internalRpcMaxSkewMs }
        : {}),
    }).then((handled) => {
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } }));
      }
    });
  });

  const io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    AuthenticatedSocketData
  >(httpServer, {
    cors: {
      origin: options.corsOrigins ?? ['http://localhost:5173'],
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token = extractHandshakeToken(socket);
    if (!token) {
      next(new Error('UNAUTHORIZED'));
      return;
    }
    const now = nowFn();
    const claims = verifyWsAuthTicket(token, sessionSecret, now);
    if (!claims) {
      next(new Error('UNAUTHORIZED'));
      return;
    }
    const remainingTtlMs = Math.max(1, claims.exp - now);
    void store
      .consumeWsTicket(claims.jti, remainingTtlMs)
      .then((consumed) => {
        if (!consumed) {
          next(new Error('UNAUTHORIZED'));
          return;
        }
        socket.data.claims = claims;
        next();
      })
      .catch(() => {
        next(new Error('UNAUTHORIZED'));
      });
  });

  io.on('connection', (socket) => {
    socket.on('envelope', (rawMessage: unknown) => {
      const baseParsed = WsEnvelopeSchema.safeParse(rawMessage);
      if (!baseParsed.success) {
        socket.emit('envelope', {
          eventId: randomUUID(),
          ts: nowFn(),
          type: 'error',
          payload: { code: 'VALIDATION_ERROR', message: 'Envelope WebSocket inválido' },
        } satisfies WsEnvelope);
        return;
      }

      const clientTypeParsed = ClientEventTypeSchema.safeParse(baseParsed.data.type);
      if (!clientTypeParsed.success) {
        socket.emit('envelope', {
          eventId: randomUUID(),
          ts: nowFn(),
          type: 'error',
          payload: {
            code: 'VALIDATION_ERROR',
            message: `Tipo de evento de cliente no permitido: ${baseParsed.data.type}`,
            refEventId: baseParsed.data.eventId,
          },
        } satisfies WsEnvelope);
        return;
      }

      if (!rateLimiter.consume(socket.id, clientTypeParsed.data, nowFn())) {
        socket.emit('envelope', {
          eventId: randomUUID(),
          ts: nowFn(),
          type: 'error',
          payload: {
            code: 'RATE_LIMITED',
            message: 'Demasiados mensajes enviados; aguardá unos segundos',
            refEventId: baseParsed.data.eventId,
          },
        } satisfies WsEnvelope);
        return;
      }

      const clientMsg = ClientMessageSchema.safeParse(rawMessage);
      if (!clientMsg.success) {
        socket.emit('envelope', {
          eventId: randomUUID(),
          ts: nowFn(),
          type: 'error',
          payload: {
            code: 'VALIDATION_ERROR',
            message: 'Payload del evento WebSocket inválido',
            refEventId: baseParsed.data.eventId,
          },
        } satisfies WsEnvelope);
        return;
      }

      void roomManager.dispatchClientMessage(socket, socket.data.claims, clientMsg.data);
    });

    socket.on('disconnect', () => {
      rateLimiter.removeConnection(socket.id);
      void roomManager.handleSocketDisconnect(socket);
    });
  });

  return {
    httpServer,
    io,
    roomManager,
    store,
    provisionRoom(spec: RoomProvisionSpec): Promise<void> {
      return roomManager.provisionRoom(spec);
    },
    deleteRoom(roomId: string): Promise<void> {
      return roomManager.closeProvisionedRoom(roomId);
    },
    listen(port: number, host = '0.0.0.0'): Promise<number> {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          const addr = httpServer.address();
          const boundPort = typeof addr === 'object' && addr !== null ? addr.port : port;
          resolve(boundPort);
        });
      });
    },
    async close(opts?: { simulateCrash?: boolean }): Promise<void> {
      if (!opts?.simulateCrash) {
        await roomManager.shutdown();
        await lifecyclePublisher.close();
      } else {
        roomManager.disposeLocalTimersOnly();
        for (const sock of io.sockets.sockets.values()) {
          sock.disconnect(true);
        }
      }
      await new Promise<void>((resolve, reject) => {
        void io.close((err) => {
          if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
            reject(err);
            return;
          }
          resolve();
        });
      });
    },
  };
}
