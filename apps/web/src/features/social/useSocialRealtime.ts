import {
  LOBBY_WS_NAMESPACE,
  SocialNotificationEventSchema,
  SocialPresenceEventSchema,
  type SocialNotificationEvent,
  type SocialPresenceEvent,
} from '@truco/shared';
import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { mintSingleUseWsTicket } from '../../lib/api-client.js';

export type SocialWsStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export function useSocialRealtime(input: {
  readonly enabled: boolean;
  readonly onNotification: (event: SocialNotificationEvent) => void;
  readonly onPresence: (event: SocialPresenceEvent) => void;
}): SocialWsStatus {
  const [status, setStatus] = useState<SocialWsStatus>('connecting');

  useEffect(() => {
    if (!input.enabled || typeof window === 'undefined') {
      setStatus('offline');
      return;
    }
    setStatus('connecting');
    let cancelled = false;
    let socket: Socket | null = null;

    void import('socket.io-client')
      .then(({ io }) => {
        if (cancelled) return;
        socket = io(LOBBY_WS_NAMESPACE, {
          path: '/lobby-socket.io',
          transports: ['websocket', 'polling'],
          withCredentials: true,
          reconnection: true,
          reconnectionDelay: 600,
          reconnectionDelayMax: 4_000,
          auth: (callback) => {
            mintSingleUseWsTicket()
              .then((ticket) => callback({ token: ticket.ticket, purpose: 'social' }))
              .catch(() => callback({ purpose: 'social' }));
          },
        });

        socket.on('connect', () => {
          if (!cancelled) setStatus('connected');
        });
        socket.io.on('reconnect_attempt', () => {
          if (!cancelled) setStatus('reconnecting');
        });
        socket.on('disconnect', () => {
          if (!cancelled) setStatus('reconnecting');
        });
        socket.on('connect_error', () => {
          if (!cancelled) setStatus('offline');
        });
        socket.on('social.ping', () => socket?.emit('social.heartbeat'));
        socket.on('social.notification', (raw: unknown) => {
          if (cancelled) return;
          const parsed = SocialNotificationEventSchema.safeParse(raw);
          if (parsed.success) input.onNotification(parsed.data);
        });
        socket.on('social.presence', (raw: unknown) => {
          if (cancelled) return;
          const parsed = SocialPresenceEventSchema.safeParse(raw);
          if (parsed.success) input.onPresence(parsed.data);
        });
      })
      .catch(() => {
        if (!cancelled) setStatus('offline');
      });

    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, [input.enabled, input.onNotification, input.onPresence]);

  return status;
}
