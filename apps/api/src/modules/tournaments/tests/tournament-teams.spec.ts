import { describe, expect, it } from 'vitest';
import {
  abandonmentKeepsMatchAlive,
  walkoverWinner,
  seatForTeamMember,
  sideDisplayName,
  TEAM_SIZE,
  teamPresence,
} from '../tournament-teams.js';

/**
 * M10a — reglas de equipos en torneos 2v2.
 *
 * Se prueban como propiedades sobre todos los casos posibles de asistencia: son pocas
 * combinaciones y cada una cambia quién avanza en el cuadro.
 */
describe('M10a equipos: asistencia y walkover', () => {
  const member = (userId: string, checkedIn: boolean) => ({ userId, checkedIn });

  it('un equipo completo se presenta con todos sus integrantes', () => {
    expect(TEAM_SIZE['2v2']).toBe(2);
    expect(teamPresence([member('a', true), member('b', true)], '2v2')).toEqual({
      kind: 'COMPLETE',
    });
    // En 1v1 alcanza con uno, que es el caso de siempre.
    expect(teamPresence([member('a', true)], '1v1')).toEqual({ kind: 'COMPLETE' });
  });

  it('un compañero ausente deja al equipo incompleto y dice quién falta', () => {
    expect(teamPresence([member('a', true), member('b', false)], '2v2')).toEqual({
      kind: 'INCOMPLETE',
      missing: ['b'],
    });
  });

  it('sin nadie presente el equipo está ausente, no incompleto', () => {
    expect(teamPresence([member('a', false), member('b', false)], '2v2')).toEqual({
      kind: 'ABSENT',
    });
  });

  it('con un integrante en 1v1 ausente, el equipo queda ausente', () => {
    expect(teamPresence([member('a', false)], '1v1')).toEqual({ kind: 'ABSENT' });
  });

  it('un lado completo contra uno que no lo está gana el cruce', () => {
    const complete = teamPresence([member('a', true), member('b', true)], '2v2');
    const incomplete = teamPresence([member('c', true), member('d', false)], '2v2');
    const absent = teamPresence([member('e', false), member('f', false)], '2v2');
    expect(walkoverWinner(complete, incomplete)).toBe('HOME');
    expect(walkoverWinner(incomplete, complete)).toBe('AWAY');
    expect(walkoverWinner(complete, absent)).toBe('HOME');
    expect(walkoverWinner(absent, complete)).toBe('AWAY');
  });

  it('dos lados completos se juegan: no se define por escritorio', () => {
    const complete = teamPresence([member('a', true), member('b', true)], '2v2');
    expect(walkoverWinner(complete, complete)).toBe('NONE');
  });

  it('si ninguno completa, el cruce se cierra sin ganador (no se inventa resultado)', () => {
    const incomplete = teamPresence([member('a', true), member('b', false)], '2v2');
    const other = teamPresence([member('c', false), member('d', true)], '2v2');
    const absent = teamPresence([member('e', false), member('f', false)], '2v2');
    expect(walkoverWinner(incomplete, other)).toBe('BOTH');
    expect(walkoverWinner(absent, absent)).toBe('BOTH');
    expect(walkoverWinner(incomplete, absent)).toBe('BOTH');
  });

  it('para cualquier combinación de presencias la decisión es total y coherente', () => {
    const states = [0, 1, 2].map((present) =>
      teamPresence([member('x', present > 0), member('y', present > 1)], '2v2'),
    );
    const valid = new Set(['NONE', 'HOME', 'AWAY', 'BOTH']);
    for (const home of states) {
      for (const away of states) {
        const outcome = walkoverWinner(home, away);
        expect(valid.has(outcome)).toBe(true);
        // Simetría: invertir los lados invierte el ganador y conserva empates.
        const mirrored = walkoverWinner(away, home);
        expect(mirrored).toBe(outcome === 'HOME' ? 'AWAY' : outcome === 'AWAY' ? 'HOME' : outcome);
        // `NONE` sólo cuando los dos están completos.
        expect(outcome === 'NONE').toBe(home.kind === 'COMPLETE' && away.kind === 'COMPLETE');
        // `BOTH` sólo cuando ninguno está completo.
        expect(outcome === 'BOTH').toBe(home.kind !== 'COMPLETE' && away.kind !== 'COMPLETE');
      }
    }
  });
});

describe('M10a equipos: abandono durante la partida', () => {
  it('en 2v2 el equipo sigue jugando mientras le quede un integrante', () => {
    expect(
      abandonmentKeepsMatchAlive({ mode: '2v2', teamMembersTotal: 2, teamMembersStillActive: 1 }),
    ).toBe(true);
  });

  it('si se van todos los integrantes, el cruce no sigue vivo por esta regla', () => {
    expect(
      abandonmentKeepsMatchAlive({ mode: '2v2', teamMembersTotal: 2, teamMembersStillActive: 0 }),
    ).toBe(false);
  });

  it('en 1v1 irse es perder: no hay compañero que sostenga la mesa', () => {
    expect(
      abandonmentKeepsMatchAlive({ mode: '1v1', teamMembersTotal: 1, teamMembersStillActive: 0 }),
    ).toBe(false);
    expect(
      abandonmentKeepsMatchAlive({ mode: '1v1', teamMembersTotal: 1, teamMembersStillActive: 1 }),
    ).toBe(false);
  });
});

describe('M10a equipos: asientos y nombres', () => {
  it('los equipos se intercalan en la mesa (seat % 2 = team)', () => {
    expect([0, 1].map((i) => seatForTeamMember(0, i))).toEqual([0, 2]);
    expect([0, 1].map((i) => seatForTeamMember(1, i))).toEqual([1, 3]);
    for (let team = 0 as 0 | 1; team <= 1; team++) {
      for (let member = 0; member < 2; member++) {
        expect(seatForTeamMember(team, member) % 2).toBe(team);
      }
    }
  });

  it('el lado muestra el nombre del equipo y, sin equipo, los apodos', () => {
    expect(sideDisplayName({ teamName: 'Los Pibes', memberNicknames: ['Ana', 'Beto'] })).toBe(
      'Los Pibes',
    );
    expect(sideDisplayName({ teamName: null, memberNicknames: ['Ana', 'Beto'] })).toBe(
      'Ana y Beto',
    );
  });
});
