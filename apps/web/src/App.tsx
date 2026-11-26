import {
  type AuthUserSummary,
  LEGAL_DOCUMENT_SLUGS,
  LEGAL_MIN_AGE_DEFAULT,
  type LegalDocumentSlug,
} from '@truco/shared';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AppShell } from './components/AppShell.js';
import { OnboardingModal } from './components/OnboardingModal.js';
import type { AuthTab } from './features/auth/AuthScreen.js';
import { SocialRealtimeProvider } from './features/social/SocialRealtimeProvider.js';
import { HomeScreen } from './features/home/HomeScreen.js';
import { messagesEsAr } from './i18n/messages.es-AR.js';
import {
  createGuestSessionRequest,
  getLegalStatusRequest,
  getMeRequest,
} from './lib/api-client.js';
import {
  applyPreferencesToDocument,
  loadClientPreferences,
  markOnboardingSeen,
} from './lib/preferences.js';

const DevMesaLazy = import.meta.env.DEV
  ? lazy(() => import('./dev/DevMesaBotPlayground.js'))
  : null;

const LiveMesaRouteLazy = lazy(() =>
  import('./features/mesa/LiveMesaRoute.js').then((m) => ({ default: m.LiveMesaRoute })),
);
const LobbyScreenLazy = lazy(() =>
  import('./features/lobby/LobbyScreen.js').then((m) => ({ default: m.LobbyScreen })),
);
const LeaderboardScreenLazy = lazy(() =>
  import('./features/ratings/LeaderboardScreen.js').then((m) => ({ default: m.LeaderboardScreen })),
);
const WaitingRoomScreenLazy = lazy(() =>
  import('./features/waiting-room/WaitingRoomScreen.js').then((m) => ({
    default: m.WaitingRoomScreen,
  })),
);
const PlayerProfileScreenLazy = lazy(() =>
  import('./features/profile/PlayerProfileScreen.js').then((m) => ({
    default: m.PlayerProfileScreen,
  })),
);
const SocialScreenLazy = lazy(() =>
  import('./features/social/SocialScreen.js').then((m) => ({ default: m.SocialScreen })),
);
const ProgressionScreenLazy = lazy(() =>
  import('./features/progression/ProgressionScreen.js').then((m) => ({
    default: m.ProgressionScreen,
  })),
);
const ProfileScreenLazy = lazy(() =>
  import('./features/profile/ProfileScreen.js').then((m) => ({ default: m.ProfileScreen })),
);
const LearnScreenLazy = lazy(() =>
  import('./features/learn/LearnScreen.js').then((m) => ({ default: m.LearnScreen })),
);
const ScorerScreenLazy = lazy(() =>
  import('./features/scorer/ScorerScreen.js').then((m) => ({ default: m.ScorerScreen })),
);
const AuthScreenLazy = lazy(() =>
  import('./features/auth/AuthScreen.js').then((m) => ({ default: m.AuthScreen })),
);
const LegalScreenLazy = lazy(() =>
  import('./features/legal/LegalScreen.js').then((m) => ({ default: m.LegalScreen })),
);

type ParsedAppRoute =
  | { kind: 'dev-mesa' }
  | { kind: 'live-mesa'; roomId: string; joinCode: string | null; isPractice: boolean }
  | { kind: 'waiting-room'; tableId: string }
  | { kind: 'lobby'; inviteOrCode: string | null }
  | { kind: 'ranking' }
  | { kind: 'profile' }
  | { kind: 'social' }
  | { kind: 'progression' }
  | { kind: 'player-profile'; userId: string }
  | { kind: 'learn' }
  | { kind: 'scorer' }
  | {
      kind: 'auth';
      tab?: AuthTab;
      resetToken: string | null;
      verifyToken: string | null;
    }
  | { kind: 'legal'; slug: LegalDocumentSlug | null }
  | { kind: 'home' };

function parseRoute(pathname: string, search: string): ParsedAppRoute {
  if (import.meta.env.DEV && pathname === '/dev/mesa') {
    return { kind: 'dev-mesa' };
  }

  const params = new URLSearchParams(search);

  const mesaMatch = /^\/mesa\/([a-zA-Z0-9_-]{3,64})$/.exec(pathname);
  if (mesaMatch?.[1]) {
    return {
      kind: 'live-mesa',
      roomId: mesaMatch[1],
      joinCode: params.get('code'),
      isPractice: params.get('practice') === '1',
    };
  }

  const salaMatch = /^\/sala\/([a-zA-Z0-9_-]{3,64})$/.exec(pathname);
  if (salaMatch?.[1]) {
    return { kind: 'waiting-room', tableId: salaMatch[1] };
  }

  if (pathname === '/lobby' || pathname === '/unirse') {
    return {
      kind: 'lobby',
      inviteOrCode: params.get('invite') ?? params.get('code'),
    };
  }

  if (pathname === '/ranking') {
    return { kind: 'ranking' };
  }

  if (pathname === '/progreso') {
    return { kind: 'progression' };
  }

  if (pathname === '/perfil') {
    return { kind: 'profile' };
  }

  if (pathname === '/amigos') {
    return { kind: 'social' };
  }

  const jugadorMatch = /^\/jugador\/([a-zA-Z0-9_-]{3,64})$/.exec(pathname);
  if (jugadorMatch?.[1]) {
    return { kind: 'player-profile', userId: jugadorMatch[1] };
  }

  if (pathname === '/aprender') {
    return { kind: 'learn' };
  }

  if (pathname === '/anotador') {
    return { kind: 'scorer' };
  }

  // Páginas legales: índice en /legal y un documento por slug conocido.
  if (pathname === '/legal' || pathname === '/legal/') {
    return { kind: 'legal', slug: null };
  }
  const legalMatch = /^\/legal\/([a-z-]{3,32})$/.exec(pathname);
  if (legalMatch?.[1] && (LEGAL_DOCUMENT_SLUGS as readonly string[]).includes(legalMatch[1])) {
    return { kind: 'legal', slug: legalMatch[1] as LegalDocumentSlug };
  }

  if (
    pathname === '/acceso' ||
    pathname === '/login' ||
    pathname === '/registro' ||
    pathname === '/recuperar'
  ) {
    const rawTab = params.get('tab');
    const inferredTab: AuthTab | undefined =
      rawTab === 'login' || rawTab === 'register' || rawTab === 'promote' || rawTab === 'recover'
        ? rawTab
        : pathname === '/registro'
          ? 'register'
          : pathname === '/recuperar'
            ? 'recover'
            : pathname === '/login'
              ? 'login'
              : undefined;
    const baseAuth: ParsedAppRoute = {
      kind: 'auth',
      resetToken: params.get('resetToken'),
      verifyToken: params.get('verifyToken'),
    };
    return inferredTab ? { ...baseAuth, tab: inferredTab } : baseAuth;
  }

  return { kind: 'home' };
}

function RouteFallback({
  reserveViewport = false,
  reserveRankingContent = false,
}: {
  readonly reserveViewport?: boolean;
  readonly reserveRankingContent?: boolean;
}) {
  const reservedSpace = reserveViewport
    ? 'grid min-h-[100svh] place-items-center'
    : reserveRankingContent
      ? 'grid min-h-[37rem] tablet:min-h-[26rem] place-items-center'
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

export function App() {
  const [locationState, setLocationState] = useState(() => ({
    pathname: typeof window !== 'undefined' ? window.location.pathname : '/',
    search: typeof window !== 'undefined' ? window.location.search : '',
  }));

  const [currentUser, setCurrentUser] = useState<AuthUserSummary | null>(null);
  const [sessionLoading, setSessionLoading] = useState<boolean>(true);
  const [onboardingOpen, setOnboardingOpen] = useState<boolean>(false);
  const [onboardingBusy, setOnboardingBusy] = useState<boolean>(false);
  /**
   * Edad mínima vigente, informada por la API. Arranca en el valor por defecto
   * para poder pintar la pantalla aunque la API todavía no haya respondido; si
   * la API falla, se mantiene el default conservador (nunca queda en 0).
   */
  const [legalMinAge, setLegalMinAge] = useState<number>(LEGAL_MIN_AGE_DEFAULT);

  useEffect(() => {
    applyPreferencesToDocument(loadClientPreferences());
  }, []);

  useEffect(() => {
    let active = true;
    void getLegalStatusRequest()
      .then((status) => {
        if (active && Number.isInteger(status.minAge) && status.minAge > 0) {
          setLegalMinAge(status.minAge);
        }
      })
      .catch(() => {
        // Se conserva el mínimo por defecto: es el valor más conservador.
      });
    return () => {
      active = false;
    };
  }, []);

  const navigate = useCallback((to: string) => {
    if (typeof window === 'undefined') return;
    window.history.pushState({}, '', to);
    setLocationState({
      pathname: window.location.pathname,
      search: window.location.search,
    });
    window.scrollTo?.({ top: 0 });
  }, []);
  const handleSessionChanged = useCallback((user: AuthUserSummary | null) => {
    setCurrentUser(user);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      setLocationState({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    let active = true;
    void getMeRequest()
      .then((me) => {
        if (!active) return;
        setCurrentUser(me.user);
      })
      .catch(() => {
        // Sin sesión previa activa: el jugador puede elegir invitado, login o registro libremente
      })
      .finally(() => {
        if (active) setSessionLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const route = parseRoute(locationState.pathname, locationState.search);

  if (route.kind === 'dev-mesa' && DevMesaLazy) {
    return (
      <SocialRealtimeProvider enabled={currentUser !== null}>
        <Suspense fallback={<div className="min-h-screen bg-surface text-ivory p-6" />}>
          <DevMesaLazy onExitHome={() => navigate('/')} />
        </Suspense>
      </SocialRealtimeProvider>
    );
  }

  if (route.kind === 'live-mesa') {
    return (
      <SocialRealtimeProvider enabled={currentUser !== null}>
        <Suspense fallback={<div className="min-h-screen bg-surface text-ivory p-6" />}>
          <LiveMesaRouteLazy
            roomId={route.roomId}
            joinCode={route.joinCode}
            isPractice={route.isPractice}
            onNavigateHome={() => navigate('/lobby')}
            onNavigate={navigate}
          />
        </Suspense>
      </SocialRealtimeProvider>
    );
  }

  if (route.kind === 'waiting-room') {
    return (
      <SocialRealtimeProvider enabled={currentUser !== null}>
        <Suspense
          fallback={
            <AppShell activeSection="lobby" currentUser={currentUser} onNavigate={navigate}>
              <RouteFallback />
            </AppShell>
          }
        >
          <WaitingRoomScreenLazy
            tableId={route.tableId}
            currentUser={currentUser}
            onSessionChanged={handleSessionChanged}
            onNavigate={navigate}
          />
        </Suspense>
      </SocialRealtimeProvider>
    );
  }

  const activeSection =
    route.kind === 'lobby'
      ? 'lobby'
      : route.kind === 'ranking'
        ? 'ranking'
        : route.kind === 'learn'
          ? 'learn'
          : route.kind === 'scorer'
            ? 'scorer'
            : route.kind === 'profile' || route.kind === 'player-profile'
              ? 'profile'
              : route.kind === 'social'
                ? 'social'
                : route.kind === 'progression'
                  ? 'progression'
                  : route.kind === 'auth'
                    ? 'auth'
                    : 'home';

  return (
    <SocialRealtimeProvider enabled={currentUser !== null}>
      <AppShell activeSection={activeSection} currentUser={currentUser} onNavigate={navigate}>
        <Suspense
          fallback={
            <RouteFallback
              reserveViewport={route.kind === 'learn'}
              reserveRankingContent={route.kind === 'ranking'}
            />
          }
        >
          {route.kind === 'home' && (
            <HomeScreen
              currentUser={currentUser}
              sessionLoading={sessionLoading}
              onSessionChanged={handleSessionChanged}
              onNavigate={navigate}
              onOpenOnboarding={() => setOnboardingOpen(true)}
            />
          )}

          {route.kind === 'lobby' && (
            <LobbyScreenLazy
              currentUser={currentUser}
              initialInviteOrCode={route.inviteOrCode}
              onSessionChanged={handleSessionChanged}
              onNavigate={navigate}
            />
          )}

          {route.kind === 'ranking' && <LeaderboardScreenLazy onNavigate={navigate} />}

          {route.kind === 'progression' && (
            <ProgressionScreenLazy currentUser={currentUser} onNavigate={navigate} />
          )}

          {route.kind === 'social' && (
            <SocialScreenLazy
              currentUser={currentUser}
              onSessionChanged={handleSessionChanged}
              onNavigate={navigate}
            />
          )}

          {route.kind === 'profile' && (
            <ProfileScreenLazy
              currentUser={currentUser}
              onSessionChanged={handleSessionChanged}
              onNavigate={navigate}
            />
          )}

          {route.kind === 'player-profile' && (
            <PlayerProfileScreenLazy
              userId={route.userId}
              currentUserId={currentUser?.id ?? null}
              onNavigate={navigate}
            />
          )}

          {route.kind === 'learn' && <LearnScreenLazy />}

          {route.kind === 'scorer' && <ScorerScreenLazy />}

          {route.kind === 'legal' && (
            <LegalScreenLazy activeSlug={route.slug} minAge={legalMinAge} onNavigate={navigate} />
          )}

          {route.kind === 'auth' && (
            <AuthScreenLazy
              currentUser={currentUser}
              {...(route.tab ? { initialTab: route.tab } : {})}
              initialResetToken={route.resetToken}
              initialVerifyToken={route.verifyToken}
              legalMinAge={legalMinAge}
              onSessionChanged={handleSessionChanged}
              onNavigate={navigate}
            />
          )}
        </Suspense>

        <OnboardingModal
          open={onboardingOpen}
          busy={onboardingBusy}
          onClose={() => {
            markOnboardingSeen();
            setOnboardingOpen(false);
          }}
          onGoToLogin={() => {
            markOnboardingSeen();
            setOnboardingOpen(false);
            navigate('/acceso');
          }}
          onEnterAsGuest={() => {
            setOnboardingBusy(true);
            void createGuestSessionRequest()
              .then((res) => {
                markOnboardingSeen();
                setCurrentUser(res.user);
                setOnboardingOpen(false);
                navigate('/lobby');
              })
              .catch(() => {
                setOnboardingOpen(false);
                navigate('/acceso');
              })
              .finally(() => setOnboardingBusy(false));
          }}
        />
      </AppShell>
    </SocialRealtimeProvider>
  );
}
