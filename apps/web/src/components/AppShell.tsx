import { DEFAULT_APP_NAME, LEGAL_DRAFT_BANNER, type AuthUserSummary } from '@truco/shared';
import { Avatar, Badge } from '@truco/ui';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { messagesEsAr } from '../i18n/messages.es-AR.js';
import {
  type ClientPreferences,
  loadClientPreferences,
  saveClientPreferences,
} from '../lib/preferences.js';

export type NavSection =
  | 'home'
  | 'lobby'
  | 'ranking'
  | 'learn'
  | 'scorer'
  | 'profile'
  | 'social'
  | 'progression'
  | 'tournaments'
  | 'auth';

/**
 * Enlaces legales del pie. El orden coincide con `legalDocumentOrder` para que el
 * índice y el pie nunca se contradigan.
 */
const legalFooterLinks: ReadonlyArray<{ path: string; label: string }> = [
  { path: '/legal/terminos', label: messagesEsAr.legal.terms },
  { path: '/legal/privacidad', label: messagesEsAr.legal.privacy },
  { path: '/legal/cookies', label: messagesEsAr.legal.cookies },
  { path: '/legal/reglas-de-conducta', label: messagesEsAr.legal.conduct },
  { path: '/legal', label: messagesEsAr.legal.index },
];

export interface AppShellProps {
  activeSection: NavSection;
  currentUser: AuthUserSummary | null;
  onNavigate: (path: string) => void;
  children: ReactNode;
}

export function AppShell({ activeSection, currentUser, onNavigate, children }: AppShellProps) {
  const appName = (import.meta.env?.['VITE_APP_NAME'] as string | undefined) ?? DEFAULT_APP_NAME;
  const [isOffline, setIsOffline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );
  const [prefs, setPrefs] = useState<ClientPreferences>(() => loadClientPreferences());
  /**
   * Señal de continuidad de la barra inferior (P1 del UX audit): mientras haya destinos
   * fuera de cuadro se muestra un degradado y una flecha; cuando ya se llegó al final,
   * desaparecen. Es puramente visual: no agrega destinos ni intercepta el desplazamiento.
   */
  const bottomNavRef = useRef<HTMLElement | null>(null);
  const [navScroll, setNavScroll] = useState<{ moreRight: boolean; moreLeft: boolean }>({
    moreRight: false,
    moreLeft: false,
  });

  const updateNavScrollState = useCallback(() => {
    const nav = bottomNavRef.current;
    if (!nav) return;
    const overflowing = nav.scrollWidth - nav.clientWidth > 2;
    const atStart = nav.scrollLeft <= 2;
    const atEnd = nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 2;
    setNavScroll({ moreRight: overflowing && !atEnd, moreLeft: overflowing && !atStart });
  }, []);

  // Medir al montar, al cambiar de destinos y al redimensionar (rotación de móvil).
  useEffect(() => {
    const nav = bottomNavRef.current;
    if (!nav) return;
    updateNavScrollState();
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateNavScrollState) : null;
    observer?.observe(nav);
    window.addEventListener('resize', updateNavScrollState);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateNavScrollState);
    };
  }, [updateNavScrollState, currentUser]);

  // Mantener visible la sección activa: al entrar (o cuando la persona navega) se revela
  // una vez. El bootstrap de sesión agrega destinos hasta la barra, así que si el primer
  // intento no encontró el ítem activo se reintenta; una vez revelado no se vuelve a
  // mover, para no pisar el desplazamiento que la persona ya hizo.
  const revealedSection = useRef<NavSection | null>(null);
  useEffect(() => {
    const nav = bottomNavRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
    const pendingReveal = revealedSection.current !== activeSection;
    if (active && pendingReveal) {
      active.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      revealedSection.current = activeSection;
    }
    updateNavScrollState();
  }, [activeSection, updateNavScrollState, currentUser]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const toggleSound = () => {
    const updated = saveClientPreferences({
      ...loadClientPreferences(),
      soundEnabled: !prefs.soundEnabled,
    });
    setPrefs(updated);
  };

  const navItems: ReadonlyArray<{ id: NavSection; label: string; path: string }> = [
    { id: 'home', label: messagesEsAr.nav.home, path: '/' },
    { id: 'lobby', label: messagesEsAr.nav.lobby, path: '/lobby' },
    { id: 'ranking', label: messagesEsAr.nav.rankings, path: '/ranking' },
    { id: 'learn', label: messagesEsAr.nav.learn, path: '/aprender' },
    { id: 'scorer', label: messagesEsAr.nav.scorer, path: '/anotador' },
    ...(currentUser
      ? [
          { id: 'social' as const, label: messagesEsAr.nav.social, path: '/amigos' },
          { id: 'tournaments' as const, label: messagesEsAr.nav.tournaments, path: '/torneos' },
          { id: 'progression' as const, label: messagesEsAr.nav.progression, path: '/progreso' },
        ]
      : []),
    currentUser
      ? { id: 'profile', label: messagesEsAr.nav.profile, path: '/perfil' }
      : { id: 'auth', label: messagesEsAr.nav.auth, path: '/acceso' },
  ];

  return (
    <div className="min-h-screen bg-cloth text-ivory flex flex-col">
      <header className="sticky top-0 z-30 bg-surface/95 backdrop-blur border-b border-gold/30 px-3 tablet:px-6 py-2">
        <div className="max-w-6xl mx-auto flex flex-wrap tablet:flex-nowrap items-center justify-between gap-3 tablet:gap-2">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="min-h-[44px] min-w-0 inline-flex items-center gap-2.5 text-left rounded-xl px-2 hover:bg-elevated/70 transition-colors"
          >
            <span
              aria-hidden="true"
              className="w-8 h-8 rounded-lg bg-cloth border border-gold/60 inline-flex items-center justify-center font-display font-bold text-gold text-base"
            >
              1E
            </span>
            <span className="font-display text-lg tablet:text-xl font-bold text-ivory truncate">
              {appName}
            </span>
          </button>

          <nav
            aria-label={messagesEsAr.nav.mainAria}
            className="hidden tablet:flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
          >
            {navItems.map((item) => {
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onNavigate(item.path)}
                  className={`min-h-[44px] shrink-0 whitespace-nowrap px-3 rounded-xl text-sm font-semibold transition-colors ${
                    active
                      ? 'bg-elevated text-gold border border-gold/50'
                      : 'text-ivory/85 hover:bg-elevated/60 hover:text-ivory border border-transparent'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Ancho reservado: al llegar la sesión, el apodo no empuja la navegación. */}
          <div className="flex shrink-0 w-[8.5rem] desktop:w-[12.5rem] items-center justify-end gap-2">
            {isOffline && <Badge variant="danger">{messagesEsAr.nav.offlineBadge}</Badge>}

            <button
              type="button"
              aria-pressed={prefs.soundEnabled}
              aria-label={
                prefs.soundEnabled ? messagesEsAr.nav.soundOnLabel : messagesEsAr.nav.soundOffLabel
              }
              onClick={toggleSound}
              className="min-h-[44px] min-w-[44px] px-2.5 rounded-xl bg-elevated border border-ivory/20 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-ivory"
            >
              {prefs.soundEnabled ? (
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M2.5 6H5.2L8.8 3V13L5.2 10H2.5V6Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M11.2 5.2C12.2 6.2 12.2 9.8 11.2 10.8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M2.5 6H5.2L8.8 3V13L5.2 10H2.5V6Z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M11 6L14 10M14 6L11 10"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={() => onNavigate(currentUser ? '/perfil' : '/acceso')}
              className="min-h-[44px] w-[6.5rem] desktop:w-[9.5rem] px-2.5 rounded-xl bg-elevated border border-gold/35 inline-flex items-center gap-2 text-xs font-semibold text-ivory"
            >
              {currentUser ? (
                <>
                  <Avatar nickname={currentUser.nickname} sizePx={26} connected team={0} />
                  <span className="min-w-0 flex-1 truncate">{currentUser.nickname}</span>
                  {currentUser.isGuest && (
                    <span className="hidden tablet:inline text-[10px] px-1.5 py-0.5 rounded bg-surface text-gold border border-gold/40">
                      {messagesEsAr.nav.guestTag}
                    </span>
                  )}
                </>
              ) : (
                <span>{messagesEsAr.nav.auth}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-3.5 tablet:px-6 py-5 pb-24 tablet:pb-8">
        {children}
      </main>

      <footer className="border-t border-ivory/15 bg-surface/60 px-3.5 tablet:px-6 py-5">
        <div className="max-w-6xl mx-auto flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
          <p className="text-[11px] leading-relaxed text-muted">
            {appName} · Juego recreativo sin dinero real: no hay apuestas, depósitos, retiros ni
            transferencias de puntos entre jugadores.
          </p>
          <nav aria-label={messagesEsAr.legal.footerAria}>
            <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
              {legalFooterLinks.map((link) => (
                <li key={link.path}>
                  <button
                    type="button"
                    onClick={() => onNavigate(link.path)}
                    className="py-1 text-[11px] font-semibold text-ivory/80 underline underline-offset-2 hover:text-gold"
                  >
                    {link.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <p className="max-w-6xl mx-auto mt-3 text-[10px] font-bold uppercase tracking-wide text-danger-strong">
          {LEGAL_DRAFT_BANNER}
        </p>
      </footer>

      {/* Barra inferior táctil en móvil (< 768px) */}
      <div className="tablet:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-gold/30">
        {navScroll.moreLeft && (
          <span
            aria-hidden="true"
            data-testid="bottom-nav-more-left"
            className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface to-transparent"
          />
        )}
        {navScroll.moreRight && (
          <span
            aria-hidden="true"
            data-testid="bottom-nav-more-right"
            className="pointer-events-none absolute inset-y-0 right-0 w-9 bg-gradient-to-l from-surface via-surface/85 to-transparent flex items-center justify-end pr-1"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M6 3.5L10.5 8L6 12.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-gold"
              />
            </svg>
          </span>
        )}
        <nav
          ref={bottomNavRef}
          aria-label={messagesEsAr.nav.mainAria}
          aria-describedby={navScroll.moreRight ? 'bottom-nav-more-hint' : undefined}
          onScroll={updateNavScrollState}
          className="overflow-x-auto pl-2 pr-11 py-1.5 flex items-center justify-start gap-1"
        >
          {navItems.map((item) => {
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => onNavigate(item.path)}
                className={`min-h-[44px] min-w-[58px] max-w-[110px] flex-none rounded-xl px-1.5 text-[10px] leading-tight font-bold transition-colors [scroll-margin-inline-end:2.75rem] ${
                  active
                    ? 'bg-elevated text-gold border border-gold/45'
                    : 'text-muted hover:text-ivory border border-transparent'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        {navScroll.moreRight && (
          <p id="bottom-nav-more-hint" className="sr-only">
            {messagesEsAr.nav.moreDestinationsHint}
          </p>
        )}
      </div>
    </div>
  );
}
