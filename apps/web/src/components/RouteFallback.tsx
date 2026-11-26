import { messagesEsAr } from '../i18n/messages.es-AR.js';

/** Cargando sección: reserva la altura esperada para que el pie no salte al llegar el chunk. */
export function RouteFallback({
  reserveViewport = false,
  reserveRankingContent = false,
  reserveLobbyContent = false,
}: {
  readonly reserveViewport?: boolean;
  readonly reserveRankingContent?: boolean;
  readonly reserveLobbyContent?: boolean;
}) {
  const reservedSpace = reserveViewport
    ? 'grid min-h-[100svh] place-items-center'
    : reserveRankingContent
      ? 'grid min-h-[37rem] tablet:min-h-[26rem] place-items-center'
      : reserveLobbyContent
        ? // Reserva la altura del lobby para que el pie no salte al llegar su chunk (CLS).
          'grid min-h-[104rem] tablet:min-h-[62rem] place-items-center'
        : '';
  return (
    <div
      role="status"
      className={`rounded-2xl bg-surface border border-ivory/20 p-8 text-center text-sm text-muted ${reservedSpace}`}
    >
      {messagesEsAr.nav.loadingSection}
    </div>
  );
}
