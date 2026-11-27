import type { ReactNode } from 'react';
import type { SpanishRank, SpanishSuit } from '../cards/deck-catalog.js';
import { designTokens, teamColor } from '../tokens/theme.js';
import { Badge } from './Badge.js';
import { Card } from './Card.js';

export interface TablePlayedCardSlot {
  readonly seat: number;
  readonly playerNickname: string;
  readonly team: number;
  readonly rank: SpanishRank;
  readonly suit: SpanishSuit;
}

export interface TableRoundSummary {
  readonly roundIndex: number;
  readonly label: string;
  readonly statusLabel?: string;
  readonly plays: readonly TablePlayedCardSlot[];
}

export interface TableProps {
  readonly topBar?: ReactNode;
  readonly topSeat?: ReactNode;
  readonly leftSeat?: ReactNode;
  readonly rightSeat?: ReactNode;
  readonly bottomArea: ReactNode;
  readonly sidePanel?: ReactNode;
  readonly centerBanner?: ReactNode;
  readonly rounds: readonly TableRoundSummary[];
  readonly emptyCenterLabel?: string;
  readonly tableAriaLabel?: string;
}

export function Table({
  topBar,
  topSeat,
  leftSeat,
  rightSeat,
  bottomArea,
  sidePanel,
  centerBanner,
  rounds,
  emptyCenterLabel = 'Esperando la primera carta sobre el paño…',
  tableAriaLabel = 'Mesa de truco en vivo',
}: TableProps) {
  const hasAnyPlay = rounds.some((r) => r.plays.length > 0);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        backgroundColor: designTokens.colors.surface,
        color: designTokens.colors.textPrimary,
        fontFamily: designTokens.typography.sansFamily,
      }}
    >
      {topBar && (
        <header
          style={{
            padding: '0.4rem 0.65rem',
            backgroundColor: designTokens.colors.surface,
            borderBottom: '1px solid rgba(224, 184, 76, 0.22)',
          }}
        >
          {topBar}
        </header>
      )}

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.65rem',
          padding: '0.45rem',
          alignItems: 'flex-start',
        }}
      >
        {/* Paño central esmeralda */}
        <section
          aria-label={tableAriaLabel}
          style={{
            flex: '1 1 600px',
            // Sin `minWidth: 0` el paño no puede encogerse por debajo de su contenido mínimo:
            // con tres equipos el tanteador y la tira de asientos suman más que la pantalla y
            // el documento entero desborda a 360 px.
            minWidth: 0,
            maxWidth: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '0.45rem',
            padding: '0.6rem',
            borderRadius: '18px',
            background: `radial-gradient(circle at 50% 45%, ${designTokens.colors.clothGreen} 0%, ${designTokens.colors.clothGreenDeep} 100%)`,
            border: '2px solid rgba(224, 184, 76, 0.38)',
            boxShadow: 'inset 0 0 42px rgba(0, 0, 0, 0.42)',
            minHeight: '520px',
          }}
        >
          {/* Asiento rival superior */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>{topSeat}</div>

          {/* Franja media: rivales laterales + arena de bazas (1ra, 2da, 3ra) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
              flexWrap: 'wrap',
            }}
          >
            {leftSeat && <div style={{ flex: '0 0 auto' }}>{leftSeat}</div>}

            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.55rem',
                minHeight: '150px',
                padding: '0.45rem',
              }}
            >
              {centerBanner}

              {hasAnyPlay ? (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    gap: '0.75rem',
                  }}
                >
                  {rounds
                    .filter((r) => r.plays.length > 0)
                    .map((round) => (
                      <div
                        key={round.roundIndex}
                        aria-label={round.label}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '0.45rem 0.6rem',
                          borderRadius: '14px',
                          backgroundColor: 'rgba(20, 32, 27, 0.56)',
                          border: '1px solid rgba(244, 239, 230, 0.16)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span
                            style={{
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              color: designTokens.colors.textMuted,
                            }}
                          >
                            {round.label}
                          </span>
                          {round.statusLabel && <Badge variant="gold">{round.statusLabel}</Badge>}
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            justifyContent: 'center',
                            gap: '0.35rem',
                            alignItems: 'flex-end',
                          }}
                        >
                          {round.plays.map((p) => (
                            <div
                              key={`${round.roundIndex}-${p.seat}`}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '0.15rem',
                              }}
                            >
                              <Card rank={p.rank} suit={p.suit} size="xs" />
                              <span
                                style={{
                                  fontSize: '0.64rem',
                                  fontWeight: 600,
                                  color: teamColor(p.team),
                                }}
                              >
                                {p.playerNickname}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <p
                  style={{
                    margin: 0,
                    fontSize: '0.82rem',
                    color: designTokens.colors.textMuted,
                    textAlign: 'center',
                  }}
                >
                  {emptyCenterLabel}
                </p>
              )}
            </div>

            {rightSeat && <div style={{ flex: '0 0 auto' }}>{rightSeat}</div>}
          </div>

          {/* Asiento propio, mano y controles inferiores */}
          <div>{bottomArea}</div>
        </section>

        {sidePanel && (
          <aside
            aria-label="Panel lateral de partida"
            style={{
              flex: '0 1 320px',
              minWidth: '280px',
              maxHeight: 'calc(100dvh - 7.5rem)',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.65rem',
            }}
          >
            {sidePanel}
          </aside>
        )}
      </div>
    </div>
  );
}
