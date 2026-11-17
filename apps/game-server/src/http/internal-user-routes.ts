import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DEFAULT_INTERNAL_RPC_MAX_SKEW_MS,
  verifyInternalRpcSignatureAndWindow,
} from '@truco/shared';
import type { RoomManager } from '../rooms/room-manager.js';
import type { GameStore } from '../store/game-store.interface.js';

const MAX_BODY_BYTES = 16 * 1024;

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readSingleHeader(req: IncomingMessage, name: string): string {
  const val = req.headers[name];
  return typeof val === 'string' ? val : '';
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Rutas internas de administración de usuarios (firma HMAC + timestamp + nonce,
 * igual que el aprovisionamiento de salas).
 *
 * `POST /internal/users/:userId/evict` con `{ reason, disconnect }`:
 * expulsa de inmediato los sockets y asientos activos del usuario sancionado.
 */
export async function tryHandleInternalUserRoutes(params: {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly internalSecret: string;
  readonly roomManager: RoomManager;
  readonly store: GameStore;
  readonly nowFn?: () => number;
  readonly maxSkewMs?: number;
}): Promise<boolean> {
  const { req, res, internalSecret, roomManager, store } = params;
  const nowFn = params.nowFn ?? Date.now;
  const maxSkewMs = params.maxSkewMs ?? DEFAULT_INTERNAL_RPC_MAX_SKEW_MS;
  const url = (req.url ?? '').split('?')[0] ?? '';
  const evictMatch = /^\/internal\/users\/([^/]+)\/evict$/.exec(url);

  if (!evictMatch) return false;
  if (req.method !== 'POST') {
    writeJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido' } });
    return true;
  }

  let rawBody: string;
  try {
    rawBody = await readRequestBody(req);
  } catch {
    writeJson(res, 413, {
      error: { code: 'VALIDATION_ERROR', message: 'Payload demasiado grande' },
    });
    return true;
  }

  const verified = verifyInternalRpcSignatureAndWindow({
    method: 'POST',
    path: url,
    timestampHeader: readSingleHeader(req, 'x-internal-timestamp'),
    nonceHeader: readSingleHeader(req, 'x-internal-nonce'),
    signatureHeader: readSingleHeader(req, 'x-internal-signature'),
    rawBody,
    secret: internalSecret,
    nowMs: nowFn(),
    maxSkewMs,
  });

  if (!verified.valid) {
    writeJson(res, 401, {
      error: {
        code: 'UNAUTHORIZED',
        message:
          verified.reason === 'TIMESTAMP_EXPIRED'
            ? 'Timestamp RPC fuera de la ventana de validez permitida'
            : 'Firma o cabeceras anti-replay internas inválidas',
      },
    });
    return true;
  }

  const nonceTtlMs = maxSkewMs * 2 + 5_000;
  const freshNonce = await store.consumeInternalRpcNonce(verified.nonce, nonceTtlMs);
  if (!freshNonce) {
    writeJson(res, 401, {
      error: { code: 'UNAUTHORIZED', message: 'Replay detectado: nonce interno ya utilizado' },
    });
    return true;
  }

  let payload: { reason?: unknown; disconnect?: unknown };
  try {
    payload = rawBody.length > 0 ? (JSON.parse(rawBody) as typeof payload) : {};
  } catch {
    writeJson(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'JSON malformado' } });
    return true;
  }

  const reason = typeof payload.reason === 'string' ? payload.reason.slice(0, 300) : '';
  const disconnect = payload.disconnect !== false;
  if (reason.length === 0) {
    writeJson(res, 400, {
      error: { code: 'VALIDATION_ERROR', message: 'Falta el motivo de la expulsión' },
    });
    return true;
  }

  const userId = decodeURIComponent(evictMatch[1] ?? '');
  const result = await roomManager.evictUser(userId, reason, disconnect);
  writeJson(res, 200, {
    evicted: result.rooms.length > 0 || result.sockets > 0,
    rooms: result.rooms,
    sockets: result.sockets,
    disconnect,
  });
  return true;
}
