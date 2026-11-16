import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DEFAULT_INTERNAL_RPC_MAX_SKEW_MS,
  RoomProvisionSpecSchema,
  verifyInternalRpcSignatureAndWindow,
} from '@truco/shared';
import type { RoomManager } from '../rooms/room-manager.js';
import type { GameStore } from '../store/game-store.interface.js';

const MAX_BODY_BYTES = 64 * 1024;

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

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readSingleHeader(req: IncomingMessage, name: string): string {
  const val = req.headers[name];
  return typeof val === 'string' ? val : '';
}

async function authenticateAntiReplayRpc(params: {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly path: string;
  readonly rawBody: string;
  readonly internalSecret: string;
  readonly store: GameStore;
  readonly nowFn: () => number;
  readonly maxSkewMs: number;
}): Promise<boolean> {
  const verified = verifyInternalRpcSignatureAndWindow({
    method: params.method,
    path: params.path,
    timestampHeader: readSingleHeader(params.req, 'x-internal-timestamp'),
    nonceHeader: readSingleHeader(params.req, 'x-internal-nonce'),
    signatureHeader: readSingleHeader(params.req, 'x-internal-signature'),
    rawBody: params.rawBody,
    secret: params.internalSecret,
    nowMs: params.nowFn(),
    maxSkewMs: params.maxSkewMs,
  });

  if (!verified.valid) {
    const message =
      verified.reason === 'TIMESTAMP_EXPIRED'
        ? 'Timestamp RPC fuera de la ventana de validez permitida'
        : 'Firma o cabeceras anti-replay internas inválidas';
    writeJson(params.res, 401, { error: { code: 'UNAUTHORIZED', message } });
    return false;
  }

  // El TTL del nonce cubre al menos el doble de la ventana de reloj permitida (+ margen)
  const nonceTtlMs = params.maxSkewMs * 2 + 5_000;
  const freshNonce = await params.store.consumeInternalRpcNonce(verified.nonce, nonceTtlMs);
  if (!freshNonce) {
    writeJson(params.res, 401, {
      error: { code: 'UNAUTHORIZED', message: 'Replay detectado: nonce interno ya utilizado' },
    });
    return false;
  }

  return true;
}

export async function tryHandleInternalProvisioningRoute(params: {
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
  const url = req.url ?? '';

  if (!url.startsWith('/internal/rooms')) {
    return false;
  }

  if (req.method === 'POST' && url === '/internal/rooms') {
    let rawBody: string;
    try {
      rawBody = await readRequestBody(req);
    } catch {
      writeJson(res, 413, {
        error: { code: 'VALIDATION_ERROR', message: 'Payload demasiado grande' },
      });
      return true;
    }

    const okAuth = await authenticateAntiReplayRpc({
      req,
      res,
      method: 'POST',
      path: '/internal/rooms',
      rawBody,
      internalSecret,
      store,
      nowFn,
      maxSkewMs,
    });
    if (!okAuth) return true;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      writeJson(res, 400, { error: { code: 'VALIDATION_ERROR', message: 'JSON malformado' } });
      return true;
    }

    const specParsed = RoomProvisionSpecSchema.safeParse(parsedJson);
    if (!specParsed.success) {
      writeJson(res, 400, {
        error: { code: 'VALIDATION_ERROR', message: 'Especificación de sala inválida' },
      });
      return true;
    }

    try {
      await roomManager.provisionRoom(specParsed.data);
      writeJson(res, 201, { provisioned: true, roomId: specParsed.data.roomId });
    } catch (err) {
      writeJson(res, 400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: err instanceof Error ? err.message : 'Error aprovisionando sala',
        },
      });
    }
    return true;
  }

  const deletePrefix = '/internal/rooms/';
  if (req.method === 'DELETE' && url.startsWith(deletePrefix)) {
    const okAuth = await authenticateAntiReplayRpc({
      req,
      res,
      method: 'DELETE',
      path: url,
      rawBody: '',
      internalSecret,
      store,
      nowFn,
      maxSkewMs,
    });
    if (!okAuth) return true;

    const roomId = decodeURIComponent(url.slice(deletePrefix.length));
    await roomManager.closeProvisionedRoom(roomId);
    writeJson(res, 200, { deleted: true, roomId });
    return true;
  }

  writeJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Ruta interna inexistente' } });
  return true;
}
