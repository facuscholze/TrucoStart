import { z } from 'zod';

/**
 * Documentos legales publicados por la plataforma.
 *
 * El orden importa: es el que se muestra en las páginas legales y en el pie del
 * sitio. `slug` es la ruta pública (`/legal/<slug>`) y se usa como identificador
 * estable en la aceptación registrada en la base de datos.
 */
export const LEGAL_DOCUMENT_SLUGS = [
  'terminos',
  'privacidad',
  'cookies',
  'reglas-de-conducta',
] as const;

export const LegalDocumentSlugSchema = z.enum(LEGAL_DOCUMENT_SLUGS);
export type LegalDocumentSlug = z.infer<typeof LegalDocumentSlugSchema>;

/**
 * Versión vigente de cada documento.
 *
 * Se persiste junto a la fecha de aceptación en `users`, así queda registro de
 * QUÉ texto aceptó cada persona y no sólo de que "aceptó algo". Toda edición
 * sustantiva de un documento debe bumpear su versión (ver `docs/LEGAL_CHECKLIST.md`).
 */
export const LEGAL_DOCUMENT_VERSIONS: Readonly<Record<LegalDocumentSlug, string>> = Object.freeze({
  terminos: '2026-11-draft-1',
  privacidad: '2026-11-draft-1',
  cookies: '2026-11-draft-1',
  'reglas-de-conducta': '2026-11-draft-1',
});

/**
 * Marca obligatoria en TODOS los documentos legales mientras no exista revisión
 * profesional. No es decorativa: un test verifica que cada página la muestre.
 */
export const LEGAL_DRAFT_BANNER = 'BORRADOR, PENDIENTE DE REVISIÓN LEGAL';

/**
 * Edad mínima por defecto si `LEGAL_MIN_AGE` no está configurada.
 *
 * Se elige 18 por ser la opción **más conservadora** (regla 11 de `CLAUDE.md`):
 * en Argentina la plena capacidad para contratar se adquiere a los 18 años
 * (CCyC, arts. 25 y 26) y los actos de personas menores de edad pueden ser de
 * nulidad relativa. El titular del producto puede bajarla por entorno cuando el
 * asesoramiento legal lo respalde, nunca subirla por código.
 */
export const LEGAL_MIN_AGE_DEFAULT = 18;

/** Rango admitido para `LEGAL_MIN_AGE` (configurable, ver `.env.example`). */
export const LEGAL_MIN_AGE_MIN = 13;
export const LEGAL_MIN_AGE_MAX = 21;

/**
 * Primera versión que debe aceptarse explícitamente al registrarse.
 *
 * Sólo Términos y Privacidad: son los dos documentos que generan obligaciones y
 * tratan datos personales. Cookies y Reglas de conducta se enlazan pero no
 * bloquean el alta.
 */
export const LEGAL_DOCUMENTS_REQUIRED_ON_REGISTRATION = ['terminos', 'privacidad'] as const;

export const LegalMinAgeSchema = z.coerce
  .number()
  .int('LEGAL_MIN_AGE debe ser un número entero')
  .min(LEGAL_MIN_AGE_MIN)
  .max(LEGAL_MIN_AGE_MAX)
  .default(LEGAL_MIN_AGE_DEFAULT);

/**
 * Aceptación que viaja en el alta de cuenta.
 *
 * `accepted: true` es literal a propósito: obliga al cliente a afirmar el
 * consentimiento de forma explícita en vez de mandar un objeto vacío que el
 * backend podría interpretar como aceptado por omisión.
 */
export const LegalAcceptanceInputSchema = z
  .object({
    accepted: z.literal(true, {
      error: 'Tenés que aceptar los Términos y la Política de Privacidad para crear la cuenta',
    }),
    /** Versiones que el cliente tenía a la vista al aceptar (se validan contra el servidor). */
    /**
     * Versiones que el cliente tenía a la vista. Es parcial a propósito: sólo se
     * exige para los documentos que requieren aceptación, y un cliente viejo que
     * no conozca un documento nuevo no debe romper.
     */
    versions: z.partialRecord(LegalDocumentSlugSchema, z.string().trim().min(1).max(64)).optional(),
    /** Edad declarada. Sólo se usa para el control de edad mínima; no se almacena. */
    age: z.coerce.number().int().min(1).max(130).optional(),
  })
  .strict();

export type LegalAcceptanceInput = z.infer<typeof LegalAcceptanceInputSchema>;

/** Estado público de los documentos legales, expuesto por `GET /v1/legal`. */
export const LegalStatusResponseSchema = z.object({
  minAge: z.number().int(),
  draft: z.literal(true),
  banner: z.string(),
  documents: z.array(
    z.object({
      slug: LegalDocumentSlugSchema,
      version: z.string(),
      requiredOnRegistration: z.boolean(),
    }),
  ),
});

export type LegalStatusResponse = z.infer<typeof LegalStatusResponseSchema>;

export function isLegalDocumentRequiredOnRegistration(slug: LegalDocumentSlug): boolean {
  return (LEGAL_DOCUMENTS_REQUIRED_ON_REGISTRATION as readonly string[]).includes(slug);
}

/** Texto de la casilla de aceptación (una sola fuente para web y tests). */
export const LEGAL_ACCEPTANCE_LABEL =
  'Tengo la edad mínima requerida y acepto los Términos y Condiciones y la Política de Privacidad.';
