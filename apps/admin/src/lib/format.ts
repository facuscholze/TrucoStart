const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Cordoba',
});

const DATE_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeZone: 'America/Argentina/Cordoba',
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return DATE_TIME_FORMATTER.format(date);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return DATE_FORMATTER.format(date);
}

export function formatExpiry(iso: string | null | undefined): string {
  if (!iso) return 'sin vencimiento';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'sin vencimiento';
  const diffMs = date.getTime() - Date.now();
  const hours = Math.round(diffMs / 3_600_000);
  if (hours <= 0) return `vencido (${formatDate(iso)})`;
  if (hours < 48) return `vence en ${hours} h`;
  return `vence el ${formatDate(iso)}`;
}
