import { DEFAULT_APP_NAME, type AuthUserSummary } from '@truco/shared';
import { Badge, CallButton, Toast } from '@truco/ui';
import { type FormEvent, lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { LiveMesaRoute } from './features/mesa/LiveMesaRoute.js';
import { messagesEsAr } from './i18n/messages.es-AR.js';
import {
  createTableRequest,
  ensureGuestOrActiveSession,
  joinTableByCodeRequest,
} from './lib/api-client.js';

// Exclusión garantizada en producción: Vite/Rollup elimina esta rama por dead-code elimination cuando import.meta.env.DEV === false
const DevMesaLazy = import.meta.env.DEV
  ? lazy(() => import('./dev/DevMesaBotPlayground.js'))
  : null;

function parseRoute(pathname: string, search: string) {
  if (import.meta.env.DEV && pathname === '/dev/mesa') {
    return { kind: 'dev-mesa' as const };
  }
  const mesaMatch = /^\/mesa\/([a-zA-Z0-9_-]{3,64})$/.exec(pathname);
  if (mesaMatch?.[1]) {
    const code = new URLSearchParams(search).get('code');
    return { kind: 'live-mesa' as const, roomId: mesaMatch[1], joinCode: code };
  }
  return { kind: 'home' as const };
}

export function App() {
  const appName = (import.meta.env?.['VITE_APP_NAME'] as string | undefined) ?? DEFAULT_APP_NAME;
  const [locationState, setLocationState] = useState(() => ({
    pathname: typeof window !== 'undefined' ? window.location.pathname : '/',
    search: typeof window !== 'undefined' ? window.location.search : '',
  }));

  const [currentUser, setCurrentUser] = useState<AuthUserSummary | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [busyAction, setBusyAction] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const navigate = useCallback((to: string) => {
    if (typeof window === 'undefined') return;
    window.history.pushState({}, '', to);
    setLocationState({
      pathname: window.location.pathname,
      search: window.location.search,
    });
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

  const route = parseRoute(locationState.pathname, locationState.search);

  useEffect(() => {
    if (route.kind !== 'home') return;
    let active = true;
    void ensureGuestOrActiveSession()
      .then((user) => {
        if (active) setCurrentUser(user);
      })
      .catch(() => {
        // En tests unitarios sin backend corriendo se muestra estado limpio sin bloquear la UI
      });
    return () => {
      active = false;
    };
  }, [route.kind]);

  if (route.kind === 'dev-mesa' && DevMesaLazy) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-surface text-ivory p-6" />}>
        <DevMesaLazy onExitHome={() => navigate('/')} />
      </Suspense>
    );
  }

  if (route.kind === 'live-mesa') {
    return (
      <LiveMesaRoute
        roomId={route.roomId}
        joinCode={route.joinCode}
        onNavigateHome={() => navigate('/')}
      />
    );
  }

  const handleQuickCreate = async (mode: '1v1' | '2v2', targetScore: 15 | 30, flor: boolean) => {
    setBusyAction(true);
    setErrorMsg(null);
    try {
      const user = currentUser ?? (await ensureGuestOrActiveSession());
      setCurrentUser(user);
      const created = await createTableRequest({
        mode,
        visibility: 'PRIVATE',
        targetScore,
        flor,
        turnTimeoutMs: 30_000,
      });
      const qs = created.joinCode ? `?code=${encodeURIComponent(created.joinCode)}` : '';
      navigate(`/mesa/${encodeURIComponent(created.roomId)}${qs}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setBusyAction(false);
    }
  };

  const handleJoinByCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!joinCodeInput.trim()) return;
    setBusyAction(true);
    setErrorMsg(null);
    try {
      const user = currentUser ?? (await ensureGuestOrActiveSession());
      setCurrentUser(user);
      const joined = await joinTableByCodeRequest(joinCodeInput);
      const qs = joined.joinCode ? `?code=${encodeURIComponent(joined.joinCode)}` : '';
      navigate(`/mesa/${encodeURIComponent(joined.roomId)}${qs}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setBusyAction(false);
    }
  };

  return (
    <main className="min-h-screen bg-cloth text-ivory flex items-center justify-center p-4 tablet:p-8">
      <section
        aria-labelledby="app-heading"
        className="max-w-xl w-full rounded-2xl bg-surface p-6 tablet:p-8 border border-gold/35 shadow-2xl space-y-5"
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Badge variant="gold">{messagesEsAr.brand.stageTag}</Badge>
          {currentUser && (
            <Badge variant="success">
              {messagesEsAr.launcher.guestReadyPrefix} {currentUser.nickname}
            </Badge>
          )}
        </div>

        <div className="space-y-1.5">
          <h1 id="app-heading" className="font-display text-3xl font-bold text-ivory">
            {appName}
          </h1>
          <p className="text-muted text-sm leading-relaxed">{messagesEsAr.brand.subtitle}</p>
        </div>

        {errorMsg && <Toast message={errorMsg} tone="danger" onDismiss={() => setErrorMsg(null)} />}

        <div className="space-y-3 pt-1">
          <h2 className="font-display text-lg font-bold text-gold">
            {messagesEsAr.launcher.heading}
          </h2>

          <div className="grid grid-cols-1 tablet:grid-cols-2 gap-3">
            <CallButton
              tone="truco"
              subtitle={messagesEsAr.launcher.points15Label}
              disabled={busyAction}
              onClick={() => void handleQuickCreate('1v1', 15, false)}
            >
              {messagesEsAr.launcher.create1v1Title}
            </CallButton>

            <CallButton
              tone="flor"
              subtitle={messagesEsAr.launcher.points30FlorLabel}
              disabled={busyAction}
              onClick={() => void handleQuickCreate('2v2', 30, true)}
            >
              {messagesEsAr.launcher.create2v2Title}
            </CallButton>
          </div>

          <form onSubmit={(e) => void handleJoinByCode(e)} className="flex gap-2 flex-wrap pt-1">
            <input
              type="text"
              maxLength={6}
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
              placeholder={messagesEsAr.launcher.joinCodePlaceholder}
              aria-label={messagesEsAr.launcher.joinCodeAriaLabel}
              className="flex-1 min-w-[180px] min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3.5 text-sm font-mono uppercase tracking-widest text-ivory placeholder:text-muted/60"
            />
            <CallButton
              tone="envido"
              disabled={busyAction || joinCodeInput.trim().length < 6}
              onClick={() => {
                if (joinCodeInput.trim().length === 6) {
                  void handleJoinByCode({
                    preventDefault: () => undefined,
                  } as FormEvent);
                }
              }}
            >
              {messagesEsAr.launcher.joinCodeAction}
            </CallButton>
          </form>

          {import.meta.env.DEV && (
            <div className="pt-2 border-t border-ivory/10 flex justify-end">
              <CallButton tone="neutral" onClick={() => navigate('/dev/mesa')}>
                {messagesEsAr.launcher.devBotRouteCta}
              </CallButton>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
