import { Inject, Injectable } from '@nestjs/common';
import {
  isLegalDocumentRequiredOnRegistration,
  LEGAL_DOCUMENT_VERSIONS,
  LEGAL_DRAFT_BANNER,
  LEGAL_MIN_AGE_DEFAULT,
  LEGAL_MIN_AGE_MAX,
  LEGAL_MIN_AGE_MIN,
  LEGAL_DOCUMENT_SLUGS,
  type LegalAcceptanceInput,
  type LegalStatusResponse,
} from '@truco/shared';
import { DomainApiException } from '../../common/api-exception.js';
import { LEGAL_RUNTIME_CONFIG, type LegalRuntimeConfig } from './legal.config.js';

/** Constancia que se persiste junto al usuario al aceptar. */
export interface LegalAcceptanceRecord {
  readonly termsVersion: string;
  readonly privacyVersion: string;
  readonly minAge: number;
}

@Injectable()
export class LegalService {
  constructor(@Inject(LEGAL_RUNTIME_CONFIG) private readonly config: LegalRuntimeConfig) {}

  getMinAge(): number {
    return this.config.minAge;
  }

  getStatus(): LegalStatusResponse {
    return {
      minAge: this.config.minAge,
      draft: true,
      banner: LEGAL_DRAFT_BANNER,
      documents: LEGAL_DOCUMENT_SLUGS.map((slug) => ({
        slug,
        version: LEGAL_DOCUMENT_VERSIONS[slug],
        requiredOnRegistration: isLegalDocumentRequiredOnRegistration(slug),
      })),
    };
  }

  /**
   * Valida la aceptación y devuelve la constancia a persistir.
   *
   * Reglas (todas del lado del servidor, nunca confiando en el cliente):
   *  1. `accepted` debe ser `true` — el esquema Zod ya lo exige, esto es defensa
   *     en profundidad para llamadas internas.
   *  2. Si el cliente declara edad, debe alcanzar `LEGAL_MIN_AGE`.
   *  3. Si el cliente informa las versiones que tenía a la vista, no se acepta una
   *     versión que no sea la vigente (evita registros con términos viejos).
   */
  validateAcceptance(input: LegalAcceptanceInput): LegalAcceptanceRecord {
    if (input.accepted !== true) {
      throw new DomainApiException(
        400,
        'VALIDATION_ERROR',
        'Tenés que aceptar los Términos y la Política de Privacidad para crear la cuenta',
        { field: 'legal' },
      );
    }

    const minAge = this.assertPlausibleMinAge(this.config.minAge);

    if (typeof input.age === 'number' && input.age < minAge) {
      throw new DomainApiException(
        403,
        'FORBIDDEN',
        `Para crear una cuenta tenés que tener al menos ${minAge} años.`,
        { field: 'legal.age' },
      );
    }

    const claimedTerms = input.versions?.terminos;
    if (claimedTerms && claimedTerms !== LEGAL_DOCUMENT_VERSIONS.terminos) {
      throw new DomainApiException(
        409,
        'CONFLICT',
        'Los Términos y Condiciones cambiaron mientras completabas el formulario. Revisalos y aceptalos de nuevo.',
        { field: 'legal.versions.terminos' },
      );
    }
    const claimedPrivacy = input.versions?.privacidad;
    if (claimedPrivacy && claimedPrivacy !== LEGAL_DOCUMENT_VERSIONS.privacidad) {
      throw new DomainApiException(
        409,
        'CONFLICT',
        'La Política de Privacidad cambió mientras completabas el formulario. Revisala y aceptala de nuevo.',
        { field: 'legal.versions.privacidad' },
      );
    }

    return {
      termsVersion: LEGAL_DOCUMENT_VERSIONS.terminos,
      privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacidad,
      minAge,
    };
  }

  /**
   * Una edad mínima fuera de rango indica configuración inválida del entorno.
   * Se prefiere fallar el alta antes que dejar entrar a alguien sin control de edad.
   */
  private assertPlausibleMinAge(minAge: number): number {
    if (minAge < LEGAL_MIN_AGE_MIN || minAge > LEGAL_MIN_AGE_MAX) {
      throw new DomainApiException(
        500,
        'INTERNAL_ERROR',
        `LEGAL_MIN_AGE debe estar entre ${LEGAL_MIN_AGE_MIN} y ${LEGAL_MIN_AGE_MAX}`,
      );
    }
    return minAge;
  }

  static parseMinAge(raw: string | undefined): number {
    if (raw === undefined || raw.trim() === '') return LEGAL_MIN_AGE_DEFAULT;
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isNaN(parsed)) return LEGAL_MIN_AGE_DEFAULT;
    return parsed;
  }
}
