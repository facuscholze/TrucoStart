import { LOBBY_WS_NAMESPACE, type GameMode, type PublicLobbyTableSummary } from '@truco/shared';
import { useCallback, useEffect, useState } from 'react';
import { io as createSocketIoClient, type Socket } from 'socket.io-client';
import {
  listPublicTablesRequest,
  mintSingleUseWsTicket,
  type PublicLobbyFilters,
} from '../../lib/api-client.js';

export type LobbyWsStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface MatchedNotification {
  tableId: string;
  roomId: string;
  mode: GameMode;
  rulesetCode: string;
  seat: number;
  team: number;
}

export interface UseLobbyRealtimeOptions {
  filters: PublicLobbyFilters;
  enabled?: boolean;
  onMatched?: (event: MatchedNotification) => void;
}

function matchesClientFilters(
  table: PublicLobbyTableSummary,
  filters: PublicLobbyFilters,
): boolean {
  if (filters.mode && table.mode !== filters.mode) return false;
  if (filters.targetScore && table.targetScore !== filters.targetScore) return false;
  if (filters.flor !== undefined && table.flor !== filters.flor) return false;
  if (filters.status && table.status !== filters.status) return false;
  return true;
}

export function useLobbyRealtime({ filters, enabled = true, onMatched }: UseLobbyRealtimeOptions) {
  const [allPublicTables, setAllPublicTables] = useState<PublicLobbyTableSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<LobbyWsStatus>('connecting');

  const reloadHttpTables = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listPublicTablesRequest({});
      setAllPublicTables(res.tables);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo obtener el listado de mesas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reloadHttpTables();
  }, [enabled, reloadHttpTables]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let cancelled = false;

    const socket: Socket = createSocketIoClient(LOBBY_WS_NAMESPACE, {
      path: '/lobby-socket.io',
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionDelay: 600,
      reconnectionDelayMax: 4_000,
      auth: (cb) => {
        mintSingleUseWsTicket()
          .then((res) => cb({ token: res.ticket }))
          .catch(() => cb({}));
      },
    });

    socket.on('connect', () => {
      if (!cancelled) setWsStatus('connected');
    });

    socket.io.on('reconnect_attempt', () => {
      if (!cancelled) setWsStatus('reconnecting');
    });

    socket.on('disconnect', () => {
      if (!cancelled) setWsStatus('reconnecting');
    });

    socket.on('connect_error', () => {
      if (!cancelled) setWsStatus('offline');
    });

    socket.on('lobby.snapshot', (payload: { tables?: PublicLobbyTableSummary[] }) => {
      if (cancelled || !Array.isArray(payload?.tables)) return;
      setAllPublicTables(payload.tables);
      setLoading(false);
      setError(null);
    });

    socket.on('lobby.tableUpsert', (payload: { table?: PublicLobbyTableSummary }) => {
      if (cancelled || !payload?.table) return;
      const incoming = payload.table;
      setAllPublicTables((prev) => {
        const idx = prev.findIndex((t) => t.id === incoming.id);
        if (idx === -1) return [incoming, ...prev];
        const copy = [...prev];
        copy[idx] = incoming;
        return copy;
      });
    });

    socket.on('lobby.tableRemoved', (payload: { tableId?: string }) => {
      if (cancelled || !payload?.tableId) return;
      setAllPublicTables((prev) => prev.filter((t) => t.id !== payload.tableId));
    });

    socket.on('matchmaking.matched', (payload: MatchedNotification) => {
      if (cancelled || !payload?.roomId) return;
      onMatched?.(payload);
    });

    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [enabled, onMatched]);

  const filteredTables = allPublicTables.filter((t) => matchesClientFilters(t, filters));

  return {
    tables: filteredTables,
    totalUnfilteredCount: allPublicTables.length,
    loading,
    error,
    wsStatus,
    reloadHttpTables,
  };
}
