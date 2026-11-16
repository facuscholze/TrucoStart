import { GameTableView } from './GameTableView.js';
import { useLiveGameRoom } from './useLiveGameRoom.js';

export interface LiveMesaRouteProps {
  readonly roomId: string;
  readonly joinCode: string | null;
  readonly onNavigateHome: () => void;
}

export function LiveMesaRoute({ roomId, joinCode, onNavigateHome }: LiveMesaRouteProps) {
  const session = useLiveGameRoom({ roomId, joinCode });

  return (
    <GameTableView
      {...session}
      onLeaveTable={() => {
        onNavigateHome();
      }}
    />
  );
}
