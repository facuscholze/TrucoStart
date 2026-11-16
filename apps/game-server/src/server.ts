import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import {
  DEFAULT_APP_NAME,
  type HealthResponse,
  type WsEnvelope,
  WsEnvelopeSchema,
} from '@truco/shared';
import { Server as SocketIOServer } from 'socket.io';

export interface GameServerOptions {
  readonly appName?: string;
  readonly corsOrigins?: string[];
}

export interface GameServerInstance {
  readonly httpServer: HttpServer;
  readonly io: SocketIOServer;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createGameServer(options: GameServerOptions = {}): GameServerInstance {
  const appName = options.appName ?? DEFAULT_APP_NAME;

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

    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } }));
  });

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: options.corsOrigins ?? ['http://localhost:5173'],
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    // TODO(STATE-02): Implementar en M2 handshake autenticado, gestor single-writer de salas, temporizadores, Redis snapshot/log y commit-reveal.
    socket.on('envelope', (rawMessage: unknown) => {
      const parsed = WsEnvelopeSchema.safeParse(rawMessage);
      if (!parsed.success) {
        const errorEnvelope: WsEnvelope = {
          eventId: randomUUID(),
          ts: Date.now(),
          type: 'error',
          payload: {
            code: 'VALIDATION_ERROR',
            message: 'Envelope WebSocket inválido',
          },
        };
        socket.emit('envelope', errorEnvelope);
        return;
      }

      const notReadyEnvelope: WsEnvelope = {
        eventId: randomUUID(),
        ts: Date.now(),
        type: 'error',
        payload: {
          code: 'INVALID_STATE',
          message: 'Gestor de salas pendiente de módulo M2',
          refEventId: parsed.data.eventId,
        },
      };
      socket.emit('envelope', notReadyEnvelope);
    });
  });

  return {
    httpServer,
    io,
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
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        void io.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    },
  };
}
