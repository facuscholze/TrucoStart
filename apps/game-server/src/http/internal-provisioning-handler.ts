import type { IncomingMessage, ServerResponse } from 'node:http';
import { RoomProvisionSpecSchema, verifyInternalServicePayload } from '@truco/shared';
import type { RoomManager } from '../rooms/room-manager.js';

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

export async function tryHandleInternalProvisioningRoute(params: {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly internalSecret: string;
  readonly roomManager: RoomManager;
}): Promise<boolean> {
  const { req, res, internalSecret, roomManager } = params;
  const url = req.url ?? '';

  if (!url.startsWith('/internal/rooms')) {
    return false;
  }

  const signature = req.headers['x-internal-signature'];
  const sigHeader = typeof signature === 'string' ? signature : '';

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

    if (!verifyInternalServicePayload(rawBody, sigHeader, internalSecret)) {
      writeJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Firma interna inválida' } });
      return true;
    }

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
    const roomId = decodeURIComponent(url.slice(deletePrefix.length));
    const canonicalPayload = `DELETE:${roomId}`;
    if (!verifyInternalServicePayload(canonicalPayload, sigHeader, internalSecret)) {
      writeJson(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Firma interna inválida' } });
      return true;
    }
    await roomManager.closeProvisionedRoom(roomId);
    writeJson(res, 200, { deleted: true, roomId });
    return true;
  }

  writeJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Ruta interna inexistente' } });
  return true;
}
