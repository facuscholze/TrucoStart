import { JOIN_CODE_ALPHABET } from '../constants/app.js';

export const NICKNAME_MIN_LENGTH = 3;
export const NICKNAME_MAX_LENGTH = 20;
const NICKNAME_FORMAT_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_]*$/;

/**
 * Raíces reservadas o insultos/discurso de odio bloqueados por defecto.
 * Se puede extender en tiempo de ejecución vía configuración (`NICKNAME_BLOCKED_TERMS`).
 */
export const DEFAULT_BLOCKED_NICKNAME_TERMS: readonly string[] = Object.freeze([
  'admin',
  'administrador',
  'moderador',
  'soporte',
  'support',
  'oficial',
  'system',
  'puto',
  'puta',
  'mierda',
  'conchud',
  'pelotud',
  'bolud',
  'mogolic',
  'pajer',
  'nazi',
  'hitler',
  'pedofil',
  'violador',
  'fuck',
  'bitch',
  'nigger',
  'faggot',
]);

const LEET_MAP: Readonly<Record<string, string>> = Object.freeze({
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
});

export function normalizeNicknameLower(nickname: string): string {
  return nickname.trim().toLowerCase();
}

export function sanitizeForProfanityScan(raw: string): string {
  const withoutAccents = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  let mapped = '';
  for (const ch of withoutAccents) {
    if (ch === '_' || ch === '-' || ch === '.' || ch === ' ') continue;
    mapped += LEET_MAP[ch] ?? ch;
  }
  // Colapsar repeticiones de 3+ caracteres iguales (ej. puuuuto -> puto)
  return mapped.replace(/(.)\1{2,}/g, '$1');
}

export interface NicknameFilterOptions {
  readonly extraBlockedTerms?: readonly string[];
  readonly replaceDefaultTerms?: readonly string[];
}

export interface NicknameValidationResult {
  readonly valid: boolean;
  readonly normalizedLower: string;
  readonly reason?: string;
}

export function validateNickname(
  rawNickname: string,
  options: NicknameFilterOptions = {},
): NicknameValidationResult {
  const trimmed = rawNickname.trim();
  const normalizedLower = trimmed.toLowerCase();

  if (trimmed.length < NICKNAME_MIN_LENGTH || trimmed.length > NICKNAME_MAX_LENGTH) {
    return {
      valid: false,
      normalizedLower,
      reason: `El apodo debe tener entre ${NICKNAME_MIN_LENGTH} y ${NICKNAME_MAX_LENGTH} caracteres`,
    };
  }

  if (!NICKNAME_FORMAT_REGEX.test(trimmed)) {
    return {
      valid: false,
      normalizedLower,
      reason: 'El apodo solo admite letras, números y guion bajo, comenzando por letra o número',
    };
  }

  const baseTerms = options.replaceDefaultTerms ?? DEFAULT_BLOCKED_NICKNAME_TERMS;
  const allTerms = [...baseTerms, ...(options.extraBlockedTerms ?? [])];
  const scanned = sanitizeForProfanityScan(trimmed);

  for (const rawTerm of allTerms) {
    const cleanTerm = sanitizeForProfanityScan(rawTerm);
    if (cleanTerm.length >= 3 && scanned.includes(cleanTerm)) {
      return {
        valid: false,
        normalizedLower,
        reason: 'El apodo elegido contiene términos reservados o no permitidos',
      };
    }
  }

  return { valid: true, normalizedLower };
}

const GUEST_PREFIXES = [
  'AnchoSur',
  'ManoBrava',
  'SieteOro',
  'EnvidoFiel',
  'FlorDePalo',
  'PieCriollo',
  'MesaChica',
  'CantoFirme',
] as const;

export function generateGuestNickname(seedBytes: Uint8Array): string {
  const prefixIdx = (seedBytes[0] ?? 0) % GUEST_PREFIXES.length;
  const prefix = GUEST_PREFIXES[prefixIdx]!;
  let suffix = '';
  for (let i = 1; i <= 5; i++) {
    const b = seedBytes[i] ?? i * 17;
    suffix += JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]!;
  }
  return `${prefix}_${suffix}`;
}
