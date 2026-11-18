import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import {
  ClientEventTypeSchema,
  ClientMessageSchema,
  DEFAULT_APP_NAME,
  type HealthResponse,
  parseCidr,
  type ParsedCidr,
  type RoomProvisionSpec,
  resolveClientIp,
  verifyWsAuthTicket,
  type BotDifficulty,
  type WsAuthTicketClaims,
  type WsEnvelope,
  WsEnvelopeSchema,
} from '@truco/shared';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import {
  type MatchLifecyclePublisher,
  NoopMatchLifecyclePublisher,
} from './events/match-lifecycle-publisher.js';
import { timingSafeEqual } from 'node:crypto';
import {
  apiSecurityHeaders,
  buildRequestLogFields,
  CORRELATION_ID_HEADER,
  createCorrelationId,
  pickCorrelationId,
} from '@truco/shared';
import { tryHandleInternalProvisioningRoute } from './http/internal-provisioning-handler.js';
import { tryHandleInternalUserRoutes } from './http/internal-user-routes.js';
import { emitRoomExpiredLifecycle } from './rooms/room-lifecycle-notifier.js';
import type { ModerationLookup } from './rooms/moderation.js';
import { GameMetrics } from './observability/game-metrics.js';
import { RoomManager } from './rooms/room-manager.js';
import { WsConnectionRateLimiter, type WsRateLimiterConfig } from './security/rate-limiter.js';
import type { GameStore } from './store/game-store.interface.js';
import { InMemoryGameStore } from './store/in-memory-game-store.js';

const DEFAULT_DEV_SECRET = 'dev-only-placeholder-secret-minimum-32-chars!!';

export interface GameServerLoggerLike {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

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
  /** TTL sin conexiones tras el cual la sala se destruye (10 minutos por defecto). */
  readonly idleRoomTtlMs?: number;
  /** Frecuencia del barrido de inactividad (60 s por defecto). `0` lo desactiva. */
  readonly idleSweepIntervalMs?: number;
  readonly internalRpcMaxSkewMs?: number;
  readonly rateLimiter?: WsRateLimiterConfig;
  /**
   * Límite de conexiones WebSocket simultáneas por userId autenticado.
   * El exceso se rechaza con `TOO_MANY_CONNECTIONS` para evitar que un solo
   * usuario agote sockets o conexiones (p. ej. pestañas zombis, abuso).
   * Por defecto 4 (dos dispositivos por mesa 1v1 + 1 pestaña lobby + margen).
   */
  readonly maxConnectionsPerUser?: number;
  /**
   * Límite de conexiones simultáneas por IP de origen real (resuelta a través
   * de proxies confiables). Protege al proceso de ataques de conexión desde un
   * único origen. Default 60 (ver ADR-020: NAT/CGNAT compartido).
   */
  readonly maxConnectionsPerIp?: number;
  /**
   * CIDRs de proxies confiables. Si la IP remota del socket está dentro de
   * alguno, se usa `trustedProxyHeader` para obtener la IP real del cliente;
   * en caso contrario las cabeceras se ignoran (anti-spoofing).
   */
  readonly trustedProxyCidrs?: readonly string[];
  /**
   * Cabecera que contiene la IP real del cliente cuando la conexión viene de
   * un proxy confiable. Default `x-forwarded-for` (Cloudflare: usar
   * `cf-connecting-ip` y pasar sus rangos en `trustedProxyCidrs`).
   */
  readonly trustedProxyHeader?: string;
  readonly nowFn?: () => number;
  /** Logger estructurado (pino) para requests internos y conexiones WebSocket. */
  readonly logger?: GameServerLoggerLike;
  /**
   * Semilla de reparto fija (hex de 64 chars) para tests E2E reproducibles.
   * Debe permanecer sin definir en producción: el reparto usa `randomBytes(32)`.
   */
  readonly dealSeedHex?: string;
  /** Rango de demora humana simulada de los bots (600–1.800 ms por defecto). */
  readonly botDecisionMinDelayMs?: number;
  readonly botDecisionMaxDelayMs?: number;
  /** Reemplazo de jugadores desconectados por un bot (desactivado por defecto). */
  readonly replaceDisconnectedWithBot?: boolean;
  /** Dificultad del bot de reemplazo (por defecto `MEDIUM`). */
  readonly botReplacementDifficulty?: BotDifficulty;
  /** Estado de moderación (suspendidos no entran, silenciados no chatean). */
  readonly moderationLookup?: ModerationLookup;
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
  readonly metrics: GameMetrics;
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
  ip: string;
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
  const logger = options.logger;
  const metrics = new GameMetrics();

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
    ...(options.idleRoomTtlMs !== undefined ? { idleRoomTtlMs: options.idleRoomTtlMs } : {}),
    ...(options.dealSeedHex !== undefined ? { dealSeedHex: options.dealSeedHex } : {}),
    ...(options.botDecisionMinDelayMs !== undefined
      ? { botDecisionMinDelayMs: options.botDecisionMinDelayMs }
      : {}),
    ...(options.botDecisionMaxDelayMs !== undefined
      ? { botDecisionMaxDelayMs: options.botDecisionMaxDelayMs }
      : {}),
    ...(options.replaceDisconnectedWithBot !== undefined
      ? { replaceDisconnectedWithBot: options.replaceDisconnectedWithBot }
      : {}),
    ...(options.botReplacementDifficulty !== undefined
      ? { botReplacementDifficulty: options.botReplacementDifficulty }
      : {}),
    ...(options.moderationLookup !== undefined
      ? { moderationLookup: options.moderationLookup }
      : {}),
    nowFn,
  });

  const rateLimiter = new WsConnectionRateLimiter(options.rateLimiter);

  // Límites de conexiones simultáneas por usuario e IP para impedir abusos
  // (pestañas zombis, un solo origen agotando sockets del proceso).
  const maxConnectionsPerUser = options.maxConnectionsPerUser ?? 4;
  const maxConnectionsPerIp = options.maxConnectionsPerIp ?? 60;
  const trustedCidrs: readonly ParsedCidr[] = (options.trustedProxyCidrs ?? [])
    .map((raw) => parseCidr(raw))
    .filter((c): c is ParsedCidr => c !== null);
  const trustedProxyHeader = (options.trustedProxyHeader ?? 'x-forwarded-for').toLowerCase();
  const connectionsPerUser = new Map<string, number>();
  const connectionsPerIp = new Map<string, number>();

  function getSocketIp(socket: Socket): string {
    return resolveClientIp({
      remoteAddress: socket.handshake.address,
      headers: socket.handshake.headers as Record<string, string | string[] | undefined>,
      trustedCidrs,
      headerName: trustedProxyHeader,
    });
  }

  function bumpCounter(map: Map<string, number>, key: string, delta: number): number {
    const next = Math.max(0, (map.get(key) ?? 0) + delta);
    if (next === 0) map.delete(key);
    else map.set(key, next);
    return next;
  }

  // Barrido de inactividad: destruye salas sin conexiones tras `idleRoomTtlMs`
  // y notifica a `apps/api` con `room.expired` para dejar la mesa consistente.
  const idleSweepIntervalMs = options.idleSweepIntervalMs ?? 60_000;
  const idleSweepTimer =
    idleSweepIntervalMs > 0
      ? setInterval(() => {
          void roomManager
            .sweepIdleRooms(nowFn())
            .then(async ({ expiredRooms }) => {
              for (const expired of expiredRooms) {
                await emitRoomExpiredLifecycle({
                  publisher: lifecyclePublisher,
                  roomId: expired.roomId,
                  tableStatus: expired.tableStatus,
                  reason: expired.reason,
                  expiredAtMs: expired.expiredAtMs,
                }).catch(() => undefined);
              }
            })
            .catch(() => undefined);
        }, idleSweepIntervalMs)
      : null;
  idleSweepTimer?.unref?.();

  const securityHeaders = apiSecurityHeaders({
    production: process.env['NODE_ENV'] === 'production',
  });

  const httpServer = createServer((req, res) => {
    const requestStartedAt = nowFn();
    const correlationId = pickCorrelationId(req.headers[CORRELATION_ID_HEADER], () =>
      createCorrelationId(),
    );
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
    res.on('finish', () => {
      logger?.info(
        buildRequestLogFields({
          service: 'game-server',
          correlationId,
          method: req.method ?? 'GET',
          path: (req.url ?? '/').split('?')[0] ?? '/',
          status: res.statusCode,
          durationMs: nowFn() - requestStartedAt,
        }),
        'http_request',
      );
    });

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

    // Métricas internas: sólo con `Authorization: Bearer $INTERNAL_RPC_SECRET`.
    if (req.method === 'GET' && req.url?.split('?')[0] === '/internal/metrics') {
      const provided = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
      const expected = Buffer.from(internalSecret);
      const candidate = Buffer.from(provided);
      const authorized =
        candidate.length === expected.length && timingSafeEqual(candidate, expected);
      if (!authorized) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(
          JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Firma interna inválida' } }),
        );
        return;
      }
      const snapshot = metrics.snapshot(roomManager.getStatusCounts());
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(snapshot));
      return;
    }

    const rpcOptions = {
      req,
      res,
      internalSecret,
      roomManager,
      store,
      nowFn,
      ...(options.internalRpcMaxSkewMs !== undefined
        ? { maxSkewMs: options.internalRpcMaxSkewMs }
        : {}),
    };

    void (async () => {
      if (await tryHandleInternalProvisioningRoute(rpcOptions)) return;
      if (await tryHandleInternalUserRoutes(rpcOptions)) return;
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } }));
    })();
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
    // Límite por IP: se aplica antes de autenticar para cortar temprano intentos
    // de flood desde un único origen sin consumir tickets WS.
    const ip = getSocketIp(socket);
    const currentFromIp = connectionsPerIp.get(ip) ?? 0;
    if (currentFromIp >= maxConnectionsPerIp) {
      next(new Error('TOO_MANY_CONNECTIONS_FROM_IP'));
      return;
    }

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

    // Límite por usuario autenticado (se cuenta al pasar el middleware; se
    // decrementa en el evento `disconnect`).
    const currentFromUser = connectionsPerUser.get(claims.userId) ?? 0;
    if (currentFromUser >= maxConnectionsPerUser) {
      next(new Error('TOO_MANY_CONNECTIONS'));
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
        socket.data.ip = ip;
        bumpCounter(connectionsPerUser, claims.userId, +1);
        bumpCounter(connectionsPerIp, ip, +1);
        next();
      })
      .catch(() => {
        next(new Error('UNAUTHORIZED'));
      });
  });

  io.on('connection', (socket) => {
    metrics.onConnectionOpened();
    logger?.info(
      {
        service: 'game-server',
        correlationId: pickCorrelationId(socket.handshake.headers[CORRELATION_ID_HEADER], () =>
          createCorrelationId(),
        ),
        socketId: socket.id,
        userId: socket.data.claims?.userId ?? null,
      },
      'ws_connected',
    );

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

      const actionStartedAt = nowFn();
      if (clientMsg.data.type === 'game.rejoin') metrics.onReconnection();
      void roomManager
        .dispatchClientMessage(socket, socket.data.claims, clientMsg.data)
        .catch(() => metrics.onError())
        .finally(() => metrics.onAction(clientMsg.data.type, nowFn() - actionStartedAt));
    });

    socket.on('disconnect', (reason) => {
      metrics.onConnectionClosed();
      logger?.info(
        {
          service: 'game-server',
          socketId: socket.id,
          userId: socket.data.claims?.userId ?? null,
          reason,
        },
        'ws_disconnected',
      );
      rateLimiter.removeConnection(socket.id);
      if (socket.data.claims) {
        bumpCounter(connectionsPerUser, socket.data.claims.userId, -1);
      }
      if (socket.data.ip) {
        bumpCounter(connectionsPerIp, socket.data.ip, -1);
      }
      void roomManager.handleSocketDisconnect(socket);
    });
  });

  return {
    httpServer,
    io,
    roomManager,
    store,
    metrics,
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
      if (idleSweepTimer) {
        clearInterval(idleSweepTimer);
      }
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
