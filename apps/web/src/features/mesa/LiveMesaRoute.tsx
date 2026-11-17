import { GameTableView } from './GameTableView.js';
import { useLiveGameRoom } from './useLiveGameRoom.js';

export interface LiveMesaRouteProps {
  readonly roomId: string;
  readonly joinCode: string | null;
  readonly onNavigateHome: () => void;
  /** `true` en mesas de práctica contra la máquina (habilita la pista de entrenamiento). */
  readonly isPractice?: boolean;
}

export function LiveMesaRoute({
  roomId,
  joinCode,
  onNavigateHome,
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
    />
  );
}
