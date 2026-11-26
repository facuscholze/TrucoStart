import type { SocialNotificationEvent, SocialPresenceEvent } from '@truco/shared';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { useSocialRealtime, type SocialWsStatus } from './useSocialRealtime.js';

interface SocialRealtimeListener {
  readonly onNotification?: (event: SocialNotificationEvent) => void;
  readonly onPresence?: (event: SocialPresenceEvent) => void;
}

interface SocialRealtimeContextValue {
  readonly status: SocialWsStatus;
  readonly subscribe: (listener: SocialRealtimeListener) => () => void;
}

const SocialRealtimeContext = createContext<SocialRealtimeContextValue | null>(null);

export function SocialRealtimeProvider({
  enabled,
  children,
}: {
  readonly enabled: boolean;
  readonly children: ReactNode;
}) {
  const listeners = useRef(new Set<SocialRealtimeListener>());

  const subscribe = useCallback((listener: SocialRealtimeListener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  const dispatchNotification = useCallback((event: SocialNotificationEvent) => {
    for (const listener of listeners.current) listener.onNotification?.(event);
  }, []);

  const dispatchPresence = useCallback((event: SocialPresenceEvent) => {
    for (const listener of listeners.current) listener.onPresence?.(event);
  }, []);

  const status = useSocialRealtime({
    enabled,
    onNotification: dispatchNotification,
    onPresence: dispatchPresence,
  });
  const value = useMemo(() => ({ status, subscribe }), [status, subscribe]);

  return <SocialRealtimeContext.Provider value={value}>{children}</SocialRealtimeContext.Provider>;
}

export function useSocialRealtimeEvents(listener: SocialRealtimeListener): SocialWsStatus {
  const context = useContext(SocialRealtimeContext);
  const subscribe = context?.subscribe;

  useEffect(() => {
    if (!subscribe) return;
    return subscribe({
      onNotification: listener.onNotification,
      onPresence: listener.onPresence,
    });
  }, [subscribe, listener.onNotification, listener.onPresence]);

  return context?.status ?? 'offline';
}
