import { LEGAL_DOCUMENT_VERSIONS, type LegalAcceptanceInput } from '@truco/shared';

/**
 * Aceptación legal válida para los tests que crean cuentas.
 *
 * Es un fixture explícito y no un valor por defecto del esquema: en producción la
 * aceptación REAL viene del checkbox del registro. Que los tests deban importarlo
 * deja visible que el alta sin consentimiento ya no es posible (ADR-023).
 */
export const TEST_LEGAL_ACCEPTANCE: LegalAcceptanceInput = {
  accepted: true,
  versions: {
    terminos: LEGAL_DOCUMENT_VERSIONS.terminos,
    privacidad: LEGAL_DOCUMENT_VERSIONS.privacidad,
  },
};
