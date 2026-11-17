import {
  DEFAULT_INTERNAL_RPC_MAX_SKEW_MS,
  verifyInternalRpcSignatureAndWindow,
} from '@truco/shared';
import type { InternalNonceStore } from './nonce-store.js';

export interface VerifySignedInternalRequestParams {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly rawBody: string;
  readonly secret: string;
  readonly nonceStore: InternalNonceStore;
  readonly nowMs?: number;
  readonly maxSkewMs?: number;
}

export type SignedInternalRequestResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: 401;
      readonly code: 'UNAUTHORIZED';
      readonly message: string;
    };

function readHeader(headers: Record<string, string | string[] | undefined>, name: string): string {
  const value = headers[name];
  return typeof value === 'string' ? value : Array.isArray(value) ? (value[0] ?? '') : '';
}

/**
 * Verifica una RPC interna firmada (HMAC-SHA256 + timestamp + nonce de un solo uso)
 * con el mismo esquema que usa `apps/api` para llamar al game-server.
 */
export async function verifySignedInternalRequest(
  params: VerifySignedInternalRequestParams,
): Promise<SignedInternalRequestResult> {
  const maxSkewMs = params.maxSkewMs ?? DEFAULT_INTERNAL_RPC_MAX_SKEW_MS;
  const verified = verifyInternalRpcSignatureAndWindow({
    method: params.method,
    path: params.path,
    timestampHeader: readHeader(params.headers, 'x-internal-timestamp'),
    nonceHeader: readHeader(params.headers, 'x-internal-nonce'),
    signatureHeader: readHeader(params.headers, 'x-internal-signature'),
    rawBody: params.rawBody,
    secret: params.secret,
    nowMs: params.nowMs ?? Date.now(),
    maxSkewMs,
  });

  if (!verified.valid) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message:
        verified.reason === 'TIMESTAMP_EXPIRED'
          ? 'Timestamp RPC fuera de la ventana de validez permitida'
          : 'Firma o cabeceras anti-replay internas inválidas',
    };
  }

  const fresh = await params.nonceStore.consume(verified.nonce, maxSkewMs * 2 + 5_000);
  if (!fresh) {
    return {
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
      message: 'Replay detectado: nonce interno ya utilizado',
    };
  }

  return { ok: true };
}
