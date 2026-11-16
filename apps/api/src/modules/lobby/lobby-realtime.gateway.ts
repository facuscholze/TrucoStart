import type { Server as HttpServer } from 'node:http';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  ACCESS_COOKIE_NAME,
  LOBBY_WS_NAMESPACE,
  LobbyWsMatchFoundEventSchema,
  LobbyWsSnapshotEventSchema,
  LobbyWsTableRemovedEventSchema,
  LobbyWsTableUpsertedEventSchema,
  MAX_PUBLIC_TABLES_RESULTS,
  type PublicLobbyTableSummary,
  PublicLobbyTableSummarySchema,
  type TableVisibility,
  verifyWsAuthTicket,
} from '@truco/shared';
import type { z } from 'zod';
import { type Namespace, Server as SocketIoServer } from 'socket.io';
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from '../../common/rate-limit/rate-limit-store.interface.js';
import { AuthRepository } from '../auth/auth.repository.js';
import { verifyAccessSessionCookie } from '../auth/security/token-crypto.js';
import { LOBBY_RUNTIME_CONFIG, type LobbyRuntimeConfig } from './lobby.config.js';

export type LobbyWsMatchFoundEvent = z.infer<typeof LobbyWsMatchFoundEventSchema>;

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    const val = part.slice(eqIdx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function userRoomName(userId: string): string {
  return `user:${userId}`;
}

function normalizeSocketIp(rawAddress: string | undefined): string {
  if (!rawAddress) return '127.0.0.1';
  if (rawAddress.startsWith('::ffff:')) {
    return rawAddress.slice('::ffff:'.length);
  }
  if (rawAddress === '::1') {
    return '127.0.0.1';
  }
  return rawAddress;
}

@Injectable()
export class LobbyRealtimeGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private io: SocketIoServer | null = null;
  private lobbyNsp: Namespace | null = null;
  private snapshotLoader: (() => Promise<PublicLobbyTableSummary[]>) | null = null;
  private closed = false;

  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Inject(LOBBY_RUNTIME_CONFIG) private readonly config: LobbyRuntimeConfig,
    @Inject(AuthRepository) private readonly authRepository: AuthRepository,
    @Inject(RATE_LIMIT_STORE) private readonly rateLimitStore: RateLimitStore,
  ) {}

  registerSnapshotLoader(loader: () => Promise<PublicLobbyTableSummary[]>): void {
    this.snapshotLoader = loader;
  }

  onApplicationBootstrap(): void {
    const httpAdapter = this.adapterHost.httpAdapter;
    if (!httpAdapter) return;
    const httpServer = httpAdapter.getHttpServer() as HttpServer | undefined;
    if (!httpServer) return;

    this.io = new SocketIoServer(httpServer, {
      cors: {
        origin: true,
        credentials: true,
      },
      serveClient: false,
    });

    // Rechazar conexiones al namespace raíz "/" para obligar aislamiento en "/lobby"
    this.io.use((_socket, next) => {
      next(new Error('NAMESPACE_FORBIDDEN'));
    });

    const nsp = this.io.of(LOBBY_WS_NAMESPACE);
    nsp.use(async (socket, next) => {
      try {
        const clientIp = normalizeSocketIp(socket.handshake.address);
        const ipRate = await this.rateLimitStore.consumeWindow(
          `lobby:ws-connect:ip:${clientIp}`,
          this.config.lobbyWsConnectIpMax,
          this.config.lobbyWsConnectWindowMs,
        );
        if (!ipRate.allowed) {
          next(new Error('RATE_LIMITED'));
          return;
        }

        const userId = await this.authenticateHandshake(socket.handshake);
        if (!userId) {
          next(new Error('UNAUTHORIZED'));
          return;
        }
        socket.data['userId'] = userId;
        socket.data['clientIp'] = clientIp;
        next();
      } catch {
        next(new Error('UNAUTHORIZED'));
      }
    });

    nsp.on('connection', (socket) => {
      const userId = socket.data['userId'] as string | undefined;
      const clientIp = (socket.data['clientIp'] as string | undefined) ?? '127.0.0.1';
      if (userId) {
        void socket.join(userRoomName(userId));
      }

      const emitCappedSnapshot = async () => {
        if (!this.snapshotLoader) return;
        const maxResults = Math.min(
          this.config.lobbyWsMaxSnapshotResults,
          MAX_PUBLIC_TABLES_RESULTS,
        );
        const tables = await this.snapshotLoader();
        const payload = LobbyWsSnapshotEventSchema.parse({
          tables: tables.slice(0, maxResults).map((t) => PublicLobbyTableSummarySchema.parse(t)),
        });
        socket.emit('lobby.snapshot', payload);
      };

      void emitCappedSnapshot().catch(() => {
        // Ignorar si el socket se cerró durante la carga inicial
      });

      socket.on('lobby.requestSnapshot', () => {
        void (async () => {
          const eventRate = await this.rateLimitStore.consumeWindow(
            `lobby:ws-event:ip:${clientIp}`,
            this.config.lobbyWsEventIpMax,
            this.config.lobbyWsConnectWindowMs,
          );
          if (!eventRate.allowed) {
            socket.emit('lobby.error', {
              code: 'RATE_LIMITED',
              message: 'Demasiadas solicitudes en tiempo real desde esta IP.',
              retryAfterMs: eventRate.retryAfterMs,
            });
            return;
          }
          await emitCappedSnapshot();
        })().catch(() => undefined);
      });
    });

    this.lobbyNsp = nsp;
  }

  private async authenticateHandshake(handshake: {
    readonly auth?: Record<string, unknown>;
    readonly headers: Record<string, string | string[] | undefined>;
  }): Promise<string | null> {
    const nowMs = this.config.nowFn();

    // Vía 1: Ticket WS efímero single-use (jti) en auth.token o auth.ticket
    const rawTicket = handshake.auth?.['token'] ?? handshake.auth?.['ticket'];
    if (typeof rawTicket === 'string' && rawTicket.length > 0) {
      const claims = verifyWsAuthTicket(rawTicket, this.config.sessionSecret, nowMs);
      if (!claims) return null;
      const ttlRemainingMs = Math.max(1_000, claims.exp - nowMs);
      const consume = await this.rateLimitStore.consumeWindow(
        `ws:jti:${claims.jti}`,
        1,
        ttlRemainingMs,
      );
      if (!consume.allowed) return null;
      return claims.userId;
    }

    // Vía 2: Cookie HttpOnly de sesión activa (mismo registrable site que REST)
    const cookieHeader =
      typeof handshake.headers['cookie'] === 'string' ? handshake.headers['cookie'] : undefined;
    const cookies = parseCookieHeader(cookieHeader);
    const accessCookie = cookies[ACCESS_COOKIE_NAME];
    const claims = verifyAccessSessionCookie(accessCookie, this.config.sessionSecret, nowMs);
    if (!claims) return null;

    const session = await this.authRepository.findSessionById(claims.sessionId);
    if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= nowMs) {
      return null;
    }
    const user = await this.authRepository.findUserById(claims.userId);
    if (!user || user.deletedAt !== null || user.status !== 'ACTIVE') {
      return null;
    }
    return user.id;
  }

  broadcastTableUpsert(visibility: TableVisibility, summary: PublicLobbyTableSummary): void {
    // Regla estricta de privacidad: jamás emitir mesas PRIVATE por /lobby
    if (visibility !== 'PUBLIC' || !this.lobbyNsp) return;

    const event = LobbyWsTableUpsertedEventSchema.parse({
      table: PublicLobbyTableSummarySchema.parse(summary),
    });
    this.lobbyNsp.emit('lobby.tableUpsert', event);
  }

  broadcastTableRemoved(tableId: string, visibility: TableVisibility): void {
    // Jamás revelar siquiera la baja de una mesa PRIVATE en el canal público
    if (visibility !== 'PUBLIC' || !this.lobbyNsp) return;

    const event = LobbyWsTableRemovedEventSchema.parse({ tableId });
    this.lobbyNsp.emit('lobby.tableRemoved', event);
  }

  notifyUserMatched(userId: string, event: LobbyWsMatchFoundEvent): void {
    if (!this.lobbyNsp) return;
    const validated = LobbyWsMatchFoundEventSchema.parse(event);
    this.lobbyNsp.to(userRoomName(userId)).emit('matchmaking.matched', validated);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.closed || !this.io) return;
    this.closed = true;
    this.io.disconnectSockets(true);
    this.io.engine.close();
    this.lobbyNsp = null;
    this.io = null;
  }
}
