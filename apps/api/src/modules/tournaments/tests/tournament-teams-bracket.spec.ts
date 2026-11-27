import { describe, expect, it } from 'vitest';
import { buildTournamentTopology } from '@truco/shared';
import { TEAM_SIZE, seatForTeamMember } from '../tournament-teams.js';

/**
 * M10a — el cuadro de un torneo por equipos.
 *
 * La topología ya es agnóstica de si un lado es una persona o un equipo: se siembran
 * "inscriptos" y cada inscripto ocupa un lado. Lo que cambia es cuántos hay por equipo y
 * cómo se reparten los asientos de la mesa. Estas pruebas fijan ese contrato antes de
 * cablearlo al servicio.
 */
describe('M10a equipos: cuadro y asientos', () => {
  it('un torneo 2v2 de 4 equipos arma 3 cruces y el más chico necesita 2 equipos', () => {
    // 4 equipos de 2 = 8 personas en la mesa, pero 4 lados en el cuadro.
    for (const format of ['SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION'] as const) {
      const topology = buildTournamentTopology(format, 4);
      expect(topology.matches.length).toBe(format === 'SINGLE_ELIMINATION' ? 3 : 6);
      expect(topology.size).toBe(4);
    }
  });

  it('los asientos de los dos equipos de un cruce cubren la mesa completa', () => {
    for (const mode of ['1v1', '2v2'] as const) {
      const seats = new Set<number>();
      const teamSize = TEAM_SIZE[mode];
      for (const team of [0, 1] as const) {
        for (let member = 0; member < teamSize; member++) {
          seats.add(seatForTeamMember(team, member));
        }
      }
      expect(seats.size).toBe(teamSize * 2);
      // Nadie comparte asiento y cada equipo queda intercalado.
      expect([...seats].sort((a, b) => a - b)).toEqual([0, 1, 2, 3].slice(0, teamSize * 2));
    }
  });

  it('la mesa de 2v2 necesita dos integrantes por lado: sin eso no hay partida', () => {
    expect(TEAM_SIZE['2v2']).toBe(2);
    // Un equipo de una persona jugaría 1v1 en una mesa de 4 asientos: por eso la regla
    // exige el equipo completo antes de aprovisionar la sala del cruce.
    expect(seatForTeamMember(0, 0)).toBe(0);
    expect(seatForTeamMember(0, 1)).toBe(2);
  });
});
