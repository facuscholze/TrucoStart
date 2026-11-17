import { useState } from 'react';
import { ReportDialog, type ReportTarget } from './ReportDialog.js';

/**
 * Botón "Reportar" reutilizable: mesa, pantalla de resultado y perfil de otro jugador.
 * Si no hay jugadores humanos a quienes reportar (bots o uno mismo), no se muestra.
 */
export function ReportButton({
  targets,
  matchId,
  myUserId,
  label = 'Reportar',
  className,
}: {
  readonly targets: readonly ReportTarget[];
  readonly matchId?: string | null;
  readonly myUserId?: string | null;
  readonly label?: string;
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);

  const reportable = targets.filter(
    (target) => target.userId.length > 0 && target.userId !== myUserId,
  );
  if (reportable.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          'rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger transition hover:bg-danger/20'
        }
      >
        {label}
      </button>
      <ReportDialog
        open={open}
        targets={reportable}
        matchId={matchId ?? null}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
