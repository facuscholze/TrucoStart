import { DEFAULT_APP_NAME, LEGAL_DRAFT_BANNER, type LegalDocumentSlug } from '@truco/shared';
import { legalDocumentOrder, legalDocuments } from './legal-content.js';

export interface LegalScreenProps {
  /** Documento activo; `null` muestra el índice de documentos legales. */
  activeSlug: LegalDocumentSlug | null;
  /** Edad mínima vigente, informada por la API (o el valor por defecto). */
  minAge: number;
  onNavigate: (path: string) => void;
}

/**
 * Aviso de borrador.
 *
 * Se renderiza SIEMPRE, en todas las páginas legales y en el índice. No se puede
 * desactivar por prop ni por entorno: el texto legal no está revisado por un
 * profesional y presentarlo como definitivo sería incorrecto (ver ADR-023).
 */
function DraftBanner() {
  return (
    <div
      role="note"
      aria-label={LEGAL_DRAFT_BANNER}
      className="rounded-2xl border-2 border-danger/70 bg-danger/10 px-4 py-3"
    >
      <p className="text-xs font-bold uppercase tracking-wide text-danger">{LEGAL_DRAFT_BANNER}</p>
      <p className="mt-1 text-xs text-ivory/85">
        Este texto es un borrador de trabajo: no constituye asesoramiento legal, puede contener
        errores y no debe tomarse como la versión definitiva del documento.
      </p>
    </div>
  );
}

function LegalIndex({ minAge, onNavigate }: { minAge: number; onNavigate: (p: string) => void }) {
  const appName = (import.meta.env?.['VITE_APP_NAME'] as string | undefined) ?? DEFAULT_APP_NAME;
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-display text-2xl tablet:text-3xl font-bold text-ivory">
          Documentos legales
        </h1>
        <p className="text-sm text-ivory/80">
          Textos de {appName}. La edad mínima para crear cuenta está configurada en {minAge} años.
        </p>
      </header>

      <DraftBanner />

      <ul className="grid gap-3 tablet:grid-cols-2">
        {legalDocumentOrder.map((slug) => {
          const doc = legalDocuments[slug];
          return (
            <li key={slug}>
              <button
                type="button"
                onClick={() => onNavigate(`/legal/${slug}`)}
                className="w-full h-full text-left rounded-2xl border border-ivory/20 bg-surface p-4 hover:border-gold/60 transition-colors"
              >
                <span className="block font-display text-lg font-bold text-gold">{doc.title}</span>
                <span className="mt-1 block text-xs text-ivory/75">{doc.summary}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted">
        Este índice y cada documento se enlazan desde el registro de cuenta y desde el pie de todas
        las páginas.
      </p>
    </div>
  );
}

export function LegalScreen({ activeSlug, minAge, onNavigate }: LegalScreenProps) {
  if (!activeSlug) return <LegalIndex minAge={minAge} onNavigate={onNavigate} />;

  const doc = legalDocuments[activeSlug];

  return (
    <article className="space-y-6">
      <nav aria-label="Migas de pan" className="text-xs text-muted">
        <button
          type="button"
          onClick={() => onNavigate('/legal')}
          className="underline underline-offset-2 hover:text-ivory"
        >
          Documentos legales
        </button>
        <span aria-hidden="true"> / </span>
        <span className="text-ivory/80">{doc.title}</span>
      </nav>

      <header className="space-y-2">
        <h1 className="font-display text-2xl tablet:text-3xl font-bold text-ivory">{doc.title}</h1>
        <p className="text-sm text-ivory/80">{doc.summary}</p>
      </header>

      <DraftBanner />

      <div className="space-y-6">
        {doc.sections.map((section) => (
          <section key={section.heading} className="space-y-2">
            <h2 className="font-display text-lg font-bold text-gold">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-sm leading-relaxed text-ivory/85">
                {paragraph}
              </p>
            ))}
            {section.bullets && (
              <ul className="list-disc pl-5 space-y-1.5 text-sm text-ivory/85">
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <nav aria-label="Otros documentos" className="border-t border-ivory/15 pt-4">
        <ul className="flex flex-wrap gap-2">
          {legalDocumentOrder
            .filter((slug) => slug !== activeSlug)
            .map((slug) => (
              <li key={slug}>
                <button
                  type="button"
                  onClick={() => onNavigate(`/legal/${slug}`)}
                  className="min-h-[44px] rounded-xl border border-ivory/20 bg-elevated px-3 text-xs font-semibold text-ivory hover:border-gold/50"
                >
                  {legalDocuments[slug].title}
                </button>
              </li>
            ))}
        </ul>
      </nav>
    </article>
  );
}
