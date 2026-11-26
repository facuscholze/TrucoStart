import type { ReactNode } from 'react';

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  readonly title?: string;
  readonly subtitle?: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-sky/25 bg-cloth/35 p-4 shadow-lg sm:p-5 ${className}`}
    >
      {(title ?? actions) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="font-display text-lg font-semibold text-ivory">{title}</h2>}
            {subtitle && <p className="mt-1 text-xs text-ivory/65">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

const TONE_CLASSES: Record<string, string> = {
  neutral: 'bg-ivory/10 text-ivory/85 border-ivory/20',
  sky: 'bg-sky/15 text-sky border-sky/35',
  gold: 'bg-gold/15 text-gold border-gold/40',
  danger: 'bg-danger/15 text-danger-strong border-danger/40',
  success: 'bg-success/15 text-success border-success/40',
};

export type Tone = keyof typeof TONE_CLASSES;

export function StatusPill({
  tone = 'neutral',
  children,
}: {
  readonly tone?: Tone;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${TONE_CLASSES[tone] ?? TONE_CLASSES['neutral']}`}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  type = 'button',
  disabled = false,
  ariaLabel,
}: {
  readonly children: ReactNode;
  readonly onClick?: (() => void) | undefined;
  readonly variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  readonly type?: 'button' | 'submit';
  readonly disabled?: boolean;
  readonly ariaLabel?: string;
}) {
  const variants: Record<string, string> = {
    primary: 'bg-gold text-surface hover:bg-gold/90',
    secondary: 'border border-sky/40 bg-sky/10 text-sky hover:bg-sky/20',
    danger: 'bg-danger/90 text-surface hover:bg-danger',
    ghost: 'text-ivory/75 hover:text-ivory',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant] ?? variants['secondary']}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-ivory/60">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-ivory/20 bg-surface/70 px-3 py-2 text-sm text-ivory outline-none focus:border-sky focus:ring-1 focus:ring-sky/60';

export function EmptyState({ children }: { readonly children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-ivory/20 px-4 py-6 text-center text-sm text-ivory/60">
      {children}
    </p>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'sky',
}: {
  readonly label: string;
  readonly value: number | string;
  readonly hint?: string;
  readonly tone?: Tone;
}) {
  const accent: Record<string, string> = {
    neutral: 'text-ivory',
    sky: 'text-sky',
    gold: 'text-gold',
    danger: 'text-danger-strong',
    success: 'text-success',
  };
  return (
    <div className="rounded-2xl border border-ivory/15 bg-surface/60 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-2 font-display text-3xl font-bold ${accent[tone] ?? accent['sky']}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
