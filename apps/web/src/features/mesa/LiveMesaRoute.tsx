import { GameTableView } from './GameTableView.js';
import { useLiveGameRoom } from './useLiveGameRoom.js';

export interface LiveMesaRouteProps {
  readonly roomId: string;
  readonly joinCode: string | null;
  readonly onNavigateHome: () => void;
  /** Navegación interna (perfil público de un rival). */
  readonly onNavigate?: (path: string) => void;
  /** `true` en mesas de práctica contra la máquina (habilita la pista de entrenamiento). */
  readonly isPractice?: boolean;
}

export function LiveMesaRoute({
  roomId,
  joinCode,
  onNavigateHome,
  onNavigate,
  isPractice = false,
}: LiveMesaRouteProps) {
  const session = useLiveGameRoom({ roomId, joinCode });

  return (
    <GameTableView
      {...session}
      isPractice={isPractice}
      practiceHint={session.practiceHint}
      onRequestHint={session.onRequestHint}
      onDismissHint={session.onDismissHint}
      onLeaveTable={() => {
        onNavigateHome();
      }}
      onOpenPlayerProfile={
        onNavigate ? (userId: string) => onNavigate(`/jugador/${userId}`) : undefined
      }
    />
  );
}
