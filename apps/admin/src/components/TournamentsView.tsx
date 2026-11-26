import type {
  TournamentDetailResponse,
  TournamentListResponse,
  TournamentStatus,
  TournamentSummary,
} from '@truco/shared';
import { useState, type FormEvent } from 'react';
import { Button, Card, EmptyState, Field, inputClass, StatusPill } from './primitives.js';

const STATUS_LABELS: Record<TournamentStatus, string> = {
  DRAFT: 'Borrador',
  REGISTRATION: 'Inscripción abierta',
  CHECK_IN: 'Check-in',
  IN_PROGRESS: 'En juego',
  FINISHED: 'Terminado',
  CANCELLED: 'Cancelado',
};

const STATUS_TONE: Record<TournamentStatus, 'neutral' | 'sky' | 'gold' | 'danger' | 'success'> = {
  DRAFT: 'neutral',
  REGISTRATION: 'sky',
  CHECK_IN: 'gold',
  IN_PROGRESS: 'gold',
  FINISHED: 'success',
  CANCELLED: 'danger',
};

const FILTERS: ReadonlyArray<{ readonly label: string; readonly value: TournamentStatus | '' }> = [
  { label: 'Todos', value: '' },
  { label: 'En juego', value: 'IN_PROGRESS' },
  { label: 'Por arrancar', value: 'REGISTRATION' },
  { label: 'Check-in', value: 'CHECK_IN' },
  { label: 'Terminados', value: 'FINISHED' },
  { label: 'Cancelados', value: 'CANCELLED' },
];

/** Motivo mínimo del servidor: 10 caracteres. Se avisa antes de mandar el formulario. */
const MIN_REASON = 10;

function prizeLine(tournament: TournamentSummary): string | null {
  if (tournament.prizes.length === 0) return null;
  const top = [...tournament.prizes].sort((a, b) => a.position - b.position)[0]!;
  const reward = top.cosmeticName ?? top.cosmeticId ?? `${top.coins} monedas`;
  return `1º puesto: ${reward} (simbólico, sin valor económico)`;
}

export function TournamentsView({
  data,
  filters,
  detail,
  busy,
  onFilterChange,
  onOpen,
  onClose,
  onCancel,
  onAdvance,
  onResolveIncident,
  onCreate,
}: {
  readonly data: TournamentListResponse;
  readonly filters: { readonly status?: TournamentStatus | undefined };
  readonly detail: TournamentDetailResponse | null;
  readonly busy: boolean;
  readonly onFilterChange: (status: TournamentStatus | undefined) => void;
  readonly onOpen: (tournamentId: string) => void;
  readonly onClose: () => void;
  readonly onCancel: (tournamentId: string, reason: string) => void;
  readonly onAdvance: (tournamentId: string, reason: string) => void;
  readonly onResolveIncident: (
    tournamentId: string,
    input: {
      readonly matchId: string;
      readonly winnerUserId: string | null;
      readonly reason: string;
    },
  ) => void;
  readonly onCreate: (input: {
    readonly name: string;
    readonly format: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION';
    readonly visibility: 'OFFICIAL' | 'PRIVATE';
    readonly mode: '1v1' | '2v2';
    readonly capacity: number;
    readonly targetScore: number;
    readonly reason: string;
  }) => void;
}) {
  // Cada acción destructiva tiene su propio motivo: compartir el campo permitía que el
  // motivo de una incidencia quedara cargado en la cancelación del torneo entero.
  const [cancelReason, setCancelReason] = useState('');
  const [incidentReason, setIncidentReason] = useState('');
  const [incidentMatchId, setIncidentMatchId] = useState('');
  const [incidentWinnerId, setIncidentWinnerId] = useState('');

  const cancelTooShort = cancelReason.trim().length > 0 && cancelReason.trim().length < MIN_REASON;
  const incidentTooShort =
    incidentReason.trim().length > 0 && incidentReason.trim().length < MIN_REASON;

  // Si el cruce elegido ya no está pendiente (lo resolvió esta misma pantalla u otro
  // operador), el formulario de incidencia desaparece en vez de quedar abierto sobre un
  // cruce cerrado.
  const incidentMatch = detail?.matches.find((match) => match.id === incidentMatchId) ?? null;
  const incidentOpen = incidentMatch !== null && incidentMatch.status === 'READY';

  return (
    <div className="space-y-4">
      <Card
        title="Torneos"
        subtitle="Crear oficiales, cancelar con motivo y resolver incidencias del cuadro. Todo queda auditado."
        actions={<StatusPill tone="gold">Premios simbólicos, sin valor económico</StatusPill>}
      >
        <p className="text-sm leading-6 text-ivory/70">
          Un torneo oficial lo crea sólo el equipo; cualquier jugador puede abrir uno privado con
          código. Nadie paga para entrar y los premios son cosméticos o monedas que no se compran ni
          se retiran. Estas acciones no tocan el rating competitivo: los cruces de torneo no cuentan
          para el ranking.
        </p>
      </Card>

      <Card
        title="Filtrar"
        subtitle="El listado incluye los torneos privados de cualquier jugador."
      >
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => {
            const active = (filters.status ?? '') === filter.value;
            return (
              <button
                key={filter.label}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onFilterChange(
                    filter.value === '' ? undefined : (filter.value as TournamentStatus),
                  )
                }
                className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                  active
                    ? 'border-gold/60 bg-gold/15 text-gold'
                    : 'border-ivory/20 text-ivory/70 hover:bg-ivory/5'
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </Card>

      <CreateTournamentForm busy={busy} onCreate={onCreate} />

      <Card title="Torneos" subtitle={`${data.items.length} en esta página`}>
        {data.items.length === 0 ? (
          <EmptyState>No hay torneos con ese filtro.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {data.items.map((tournament) => (
              <li
                key={tournament.id}
                className="rounded-xl border border-ivory/10 bg-surface/40 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-ivory">{tournament.name}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={STATUS_TONE[tournament.status]}>
                      {STATUS_LABELS[tournament.status]}
                    </StatusPill>
                    <StatusPill tone={tournament.visibility === 'OFFICIAL' ? 'sky' : 'neutral'}>
                      {tournament.visibility === 'OFFICIAL' ? 'Oficial' : 'Privado'}
                    </StatusPill>
                  </span>
                </div>
                <p className="mt-1 text-xs text-ivory/60">
                  {tournament.format === 'SINGLE_ELIMINATION'
                    ? 'Eliminación simple'
                    : 'Eliminación doble'}{' '}
                  · {tournament.mode} · {tournament.targetScore} puntos ·{' '}
                  {tournament.checkedInCount}/{tournament.capacity} con check-in · organiza{' '}
                  {tournament.createdByNickname}
                </p>
                {prizeLine(tournament) && (
                  <p className="mt-1 text-xs text-gold/80">{prizeLine(tournament)}</p>
                )}
                <div className="mt-2">
                  <Button onClick={() => onOpen(tournament.id)}>Abrir cuadro</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {detail && (
        <Card
          title={detail.tournament.name}
          subtitle="Detalle de staff: incluye lo que el jugador no ve."
          actions={
            <Button variant="ghost" onClick={onClose}>
              Cerrar detalle
            </Button>
          }
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone={STATUS_TONE[detail.tournament.status]}>
                {STATUS_LABELS[detail.tournament.status]}
              </StatusPill>
              <span className="text-xs text-ivory/60">
                {detail.participants.length} inscriptos · {detail.matches.length} cruces
              </span>
            </div>

            {detail.matches.length === 0 ? (
              <EmptyState>El cuadro todavía no está armado.</EmptyState>
            ) : (
              <ul className="space-y-2">
                {detail.matches.map((match) => (
                  <li
                    key={match.id}
                    className="rounded-xl border border-ivory/10 bg-surface/40 p-3 text-sm"
                  >
                    <p className="text-xs uppercase tracking-wide text-ivory/50">
                      {match.bracket === 'WINNERS'
                        ? 'Llave de ganadores'
                        : match.bracket === 'LOSERS'
                          ? 'Repechaje'
                          : 'Final'}{' '}
                      · ronda {match.round} · cruce {match.slot + 1}
                    </p>
                    <p className="mt-1 text-ivory">
                      {match.homeNickname ?? 'A confirmar'} vs {match.awayNickname ?? 'A confirmar'}
                    </p>
                    <p className="mt-1 text-xs text-ivory/60">
                      {match.status === 'SCHEDULED'
                        ? 'A confirmar'
                        : match.status === 'READY'
                          ? 'Listo para jugar'
                          : match.status === 'IN_PROGRESS'
                            ? 'Jugándose'
                            : match.status === 'COMPLETED'
                              ? 'Jugado'
                              : 'Cerrado por incidencia'}
                      {match.winnerUserId && (
                        <>
                          {' '}
                          · ganó{' '}
                          {match.winnerUserId === match.homeUserId
                            ? match.homeNickname
                            : match.awayNickname}
                        </>
                      )}
                    </p>
                    {match.status === 'READY' && (
                      <button
                        type="button"
                        onClick={() => {
                          setIncidentMatchId(match.id);
                          setIncidentWinnerId('');
                        }}
                        className="mt-2 min-h-9 rounded-lg border border-gold/50 bg-gold/10 px-3 py-1 text-xs font-semibold text-gold hover:bg-gold/20"
                      >
                        Resolver este cruce
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {incidentOpen && incidentMatch && (
              <form
                className="space-y-3 rounded-xl border border-gold/30 bg-gold/5 p-3"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  onResolveIncident(detail.tournament.id, {
                    matchId: incidentMatch.id,
                    winnerUserId: incidentWinnerId === '' ? null : incidentWinnerId,
                    reason: incidentReason.trim(),
                  });
                }}
              >
                <p className="text-sm font-semibold text-gold">Resolver incidencia</p>
                <Field
                  label="Ganador"
                  hint="Dejarlo en «sin ganador» cierra el cruce y nadie avanza: usalo sólo si la partida no se jugó."
                >
                  <select
                    className={inputClass}
                    value={incidentWinnerId}
                    onChange={(event) => setIncidentWinnerId(event.target.value)}
                  >
                    <option value="">Sin ganador (nadie avanza)</option>
                    {[incidentMatch.homeUserId, incidentMatch.awayUserId]
                      .filter((userId): userId is string => userId !== null)
                      .map((userId) => (
                        <option key={userId} value={userId}>
                          {detail.participants.find((p) => p.userId === userId)?.nickname ?? userId}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field
                  label="Motivo"
                  hint={`Mínimo ${MIN_REASON} caracteres. Queda en la auditoría.`}
                >
                  <input
                    className={inputClass}
                    value={incidentReason}
                    onChange={(event) => setIncidentReason(event.target.value)}
                    placeholder="Qué pasó y por qué se resuelve así"
                  />
                </Field>
                {incidentTooShort && (
                  <p role="alert" className="text-xs text-danger-strong">
                    El motivo todavía es muy corto.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={busy || incidentReason.trim().length < MIN_REASON}
                  >
                    Confirmar resolución
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setIncidentMatchId('');
                      setIncidentReason('');
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            )}

            <form
              className="space-y-3 border-t border-ivory/10 pt-3"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                onCancel(detail.tournament.id, cancelReason.trim());
              }}
            >
              <Field
                label="Cancelar el torneo"
                hint="El motivo es obligatorio y queda en la auditoría. Los premios no se pagan."
              >
                <input
                  className={inputClass}
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  placeholder="Motivo de la cancelación"
                />
              </Field>
              {cancelTooShort && (
                <p role="alert" className="text-xs text-danger-strong">
                  El motivo todavía es muy corto.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  variant="danger"
                  disabled={
                    busy ||
                    cancelReason.trim().length < MIN_REASON ||
                    detail.tournament.status === 'CANCELLED' ||
                    detail.tournament.status === 'FINISHED'
                  }
                >
                  Cancelar torneo
                </Button>
                {/* Un torneo cancelado o terminado no tiene ronda que empujar: el botón
                    se esconde en vez de quedar deshabilitado sin explicación. */}
                {detail.tournament.status !== 'CANCELLED' &&
                  detail.tournament.status !== 'FINISHED' && (
                    <Button
                      variant="secondary"
                      disabled={busy || cancelReason.trim().length < MIN_REASON}
                      onClick={() => onAdvance(detail.tournament.id, cancelReason.trim())}
                    >
                      Forzar avance de ronda
                    </Button>
                  )}
              </div>
            </form>
          </div>
        </Card>
      )}
    </div>
  );
}

function CreateTournamentForm({
  busy,
  onCreate,
}: {
  readonly busy: boolean;
  readonly onCreate: (input: {
    readonly name: string;
    readonly format: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION';
    readonly visibility: 'OFFICIAL' | 'PRIVATE';
    readonly mode: '1v1' | '2v2';
    readonly capacity: number;
    readonly targetScore: number;
    readonly reason: string;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState<'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION'>(
    'SINGLE_ELIMINATION',
  );
  const [visibility, setVisibility] = useState<'OFFICIAL' | 'PRIVATE'>('OFFICIAL');
  const [mode, setMode] = useState<'1v1' | '2v2'>('1v1');
  const [capacity, setCapacity] = useState(8);
  const [targetScore, setTargetScore] = useState(15);
  const [reason, setReason] = useState('');

  return (
    <Card
      title="Crear torneo oficial"
      subtitle="Crear como staff deja el torneo oficial y auditado. Cualquier jugador puede crear uno privado desde la app."
    >
      <form
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onCreate({
            name: name.trim(),
            format,
            visibility,
            mode,
            capacity,
            targetScore,
            reason: reason.trim(),
          });
        }}
      >
        <Field label="Nombre">
          <input
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Copa de Otoño"
          />
        </Field>
        <Field label="Formato">
          <select
            className={inputClass}
            value={format}
            onChange={(event) => setFormat(event.target.value as typeof format)}
          >
            <option value="SINGLE_ELIMINATION">Eliminación simple</option>
            <option value="DOUBLE_ELIMINATION">Eliminación doble</option>
          </select>
        </Field>
        <Field label="Modalidad">
          <select
            className={inputClass}
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="1v1">1v1</option>
            <option value="2v2">2v2</option>
          </select>
        </Field>
        <Field label="Visibilidad">
          <select
            className={inputClass}
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as typeof visibility)}
          >
            <option value="OFFICIAL">Oficial</option>
            <option value="PRIVATE">Privado con código</option>
          </select>
        </Field>
        <Field
          label="Cupo"
          hint="Entre 2 y 64. Con cupos que no son potencia de 2 se reparten byes."
        >
          <input
            type="number"
            min={2}
            max={64}
            className={inputClass}
            value={capacity}
            onChange={(event) => setCapacity(Number(event.target.value))}
          />
        </Field>
        <Field label="Puntaje objetivo">
          <select
            className={inputClass}
            value={targetScore}
            onChange={(event) => setTargetScore(Number(event.target.value))}
          >
            <option value={15}>15 puntos</option>
            <option value={30}>30 puntos</option>
          </select>
        </Field>
        <Field label="Motivo" hint={`Mínimo ${MIN_REASON} caracteres.`}>
          <input
            className={inputClass}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Por qué se crea este torneo"
          />
        </Field>
        <div className="flex items-end">
          <Button
            type="submit"
            variant="primary"
            disabled={busy || name.trim().length === 0 || reason.trim().length < MIN_REASON}
          >
            Crear torneo
          </Button>
        </div>
      </form>
    </Card>
  );
}
