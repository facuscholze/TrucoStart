import { applyAction, viewFor } from '@truco/engine';
import { TUTORIAL_LESSONS } from '@truco/shared';
import { describe, expect, it } from 'vitest';
import { buildLessonState, parseTutorialActionCode } from '../src/features/learn/TutorialScreen.js';

describe('tutorial fijo (M6)', () => {
  it('cada lección arranca en un estado válido tras aplicar su guion', () => {
    expect(TUTORIAL_LESSONS).toHaveLength(6);
    for (const lesson of TUTORIAL_LESSONS) {
      const { state, error } = buildLessonState(lesson);
      expect(error, lesson.id).toBeNull();
      expect(state.status).toBe('IN_PROGRESS');
      expect(state.hand.activeSeat, lesson.id).toBe(0);
    }
  });

  it('la jugada correcta de cada lección es legal y aceptada por el motor', () => {
    for (const lesson of TUTORIAL_LESSONS) {
      const { state } = buildLessonState(lesson);
      const code = lesson.deal.correctActions[0]!;
      const action = parseTutorialActionCode(code, 0);
      expect(action, lesson.id).not.toBeNull();
      const legal = viewFor(state, 0).legalActions;
      const matches = legal.some(
        (candidate) =>
          candidate.type === action!.type &&
          (!('cardId' in candidate) ||
            !('cardId' in action!) ||
            candidate.cardId === action!.cardId),
      );
      expect(matches, `${lesson.id} → ${code}`).toBe(true);
      const res = applyAction(state, action!);
      expect(res.ok, `${lesson.id} → ${code}`).toBe(true);
    }
  });

  it('las lecciones con respuesta a un canto quedan pendientes del rival', () => {
    const truco = TUTORIAL_LESSONS.find((lesson) => lesson.id === 'truco-retruco');
    expect(truco).toBeDefined();
    const { state } = buildLessonState(truco!);
    expect(state.hand.responderTeam).toBe(0);
    expect(viewFor(state, 0).legalActions.some((a) => a.type === 'RESPOND_TRUCO')).toBe(true);
  });
});
