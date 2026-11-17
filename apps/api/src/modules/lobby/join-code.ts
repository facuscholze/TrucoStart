import { randomBytes } from 'node:crypto';
import {
  generateJoinCodeFromRandomBytes,
  JOIN_CODE_LENGTH,
  normalizeJoinCode,
} from '@truco/shared';

export function generateJoinCode(): string {
  return generateJoinCodeFromRandomBytes(randomBytes(JOIN_CODE_LENGTH));
}

export { normalizeJoinCode };
