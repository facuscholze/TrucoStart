import { z } from 'zod';

/**
 * Catálogo de lecciones del tutorial interactivo (M6).
 *
 * Cada lección usa un reparto fijo y determinista (`deal`), de modo que el jugador siempre ve
 * la misma situación y puede practicar la jugada correcta. La resolución de la lección corre en
 * el cliente con `@truco/engine` (motor puro) y el avance se guarda en la cuenta.
 */
export const TUTORIAL_LESSON_IDS = [
  'jerarquia-cartas',
  'ganar-la-mano',
  'envido',
  'truco-retruco',
  'flor',
  'senas',
] as const;
export type TutorialLessonId = (typeof TUTORIAL_LESSON_IDS)[number];

export const TutorialLessonIdSchema = z.enum(TUTORIAL_LESSON_IDS);

export const TutorialProgressResponseSchema = z.object({
  completedLessons: z.array(TutorialLessonIdSchema).max(TUTORIAL_LESSON_IDS.length),
  totalLessons: z.number().int().positive(),
  updatedAt: z.string().nullable(),
});
export type TutorialProgressResponse = z.infer<typeof TutorialProgressResponseSchema>;

export const TutorialProgressUpdateRequestSchema = z
  .object({
    completedLessons: z.array(TutorialLessonIdSchema).max(TUTORIAL_LESSON_IDS.length),
  })
  .strict();
export type TutorialProgressUpdateRequest = z.infer<typeof TutorialProgressUpdateRequestSchema>;

/** Cartas de un reparto fijo: ids del motor (`rank-suit`). */
export interface TutorialDeal {
  readonly hands: Readonly<Record<string, readonly string[]>>;
  readonly manoSeat: number;
  /** Acciones legales esperadas como "paso correcto" (`PLAY_CARD:1-espadas`, `CALL_ENVIDO:ENVIDO`). */
  readonly correctActions: readonly string[];
}

export interface TutorialLesson {
  readonly id: TutorialLessonId;
  readonly title: string;
  /** Objetivo de la lección en una línea. */
  readonly objective: string;
  /** Pasos guiados que explican el orden de las jugadas. */
  readonly steps: readonly string[];
  /** Mensaje de error amable cuando el jugador elige otra jugada. */
  readonly gentleCorrection: string;
  readonly mode: '1v1' | '2v2';
  readonly deal: TutorialDeal;
}

const SUITS = ['espadas', 'bastos', 'oros', 'copas'] as const;
void SUITS;

/**
 * Lecciones con repartos fijos. Los ids de carta siguen el formato del motor (`1-espadas`).
 * El asiento 0 es siempre el jugador que aprende.
 */
const LESSONS: readonly TutorialLesson[] = [
  {
    id: 'jerarquia-cartas',
    title: 'La jerarquía de las cartas',
    objective: 'Aprendé qué carta manda cuando hay dos naipes en la mesa.',
    steps: [
      'El 1 de espadas es la carta más fuerte del mazo (el "macho").',
      'Después vienen el 1 de bastos y los sietes de espadas y oros.',
      'Tirá la carta más baja que alcance para ganar la baza y guardá las altas.',
    ],
    gentleCorrection: 'Casi: acordate de que el 1 de espadas le gana a cualquier otra carta.',
    mode: '1v1',
    deal: {
      hands: { '0': ['1-espadas', '5-copas', '4-bastos'], '1': ['7-oros', '6-oros', '3-copas'] },
      manoSeat: 1,
      correctActions: ['PLAY_CARD:1-espadas'],
    },
  },
  {
    id: 'ganar-la-mano',
    title: 'Ganar la mano',
    objective: 'Ganá dos de las tres bazas para llevarte los puntos de la mano.',
    steps: [
      'La primera baza la ganó tu rival con el 12 de espadas.',
      'Tenés el 1 de bastos: es más fuerte y te devuelve la mano.',
      'Guardá el 6 de copas para la tercera baza.',
    ],
    gentleCorrection: 'Con el 1 de bastos ganás seguro esa baza: probá con esa carta.',
    mode: '1v1',
    deal: {
      hands: { '0': ['1-bastos', '6-copas', '4-oros'], '1': ['12-espadas', '5-bastos', '3-oros'] },
      manoSeat: 0,
      correctActions: ['PLAY_CARD:1-bastos'],
    },
  },
  {
    id: 'envido',
    title: 'El envido',
    objective: 'Cantá el envido cuando tu tanto es alto.',
    steps: [
      'El tanto se cuenta con las dos cartas más altas del mismo palo, más 20.',
      'Con 7 y 6 de oros tenés 33 de envido: es casi imbatible.',
      'Cantá Envido antes de tirar la primera carta.',
    ],
    gentleCorrection: 'Con 33 de envido conviene cantar: son puntos casi seguros.',
    mode: '1v1',
    deal: {
      hands: { '0': ['7-oros', '6-oros', '4-copas'], '1': ['5-bastos', '3-espadas', '2-copas'] },
      manoSeat: 0,
      correctActions: ['CALL_ENVIDO:ENVIDO', 'CALL_ENVIDO:REAL_ENVIDO'],
    },
  },
  {
    id: 'truco-retruco',
    title: 'Truco y retruco',
    objective: 'Decidí cuándo aceptar un Truco mirando tu mano y el marcador.',
    steps: [
      'Tu rival cantó Truco y vos tenés el 1 de espadas en la mano.',
      'Con una carta imbatible nunca se dice "No quiero".',
      'Decile "Quiero" y jugá tranquilo.',
    ],
    gentleCorrection: 'Con el 1 de espadas en la mano conviene decir "Quiero".',
    mode: '1v1',
    deal: {
      hands: {
        '0': ['1-espadas', '4-bastos', '3-copas'],
        '1': ['7-oros', '6-espadas', '5-bastos'],
      },
      manoSeat: 1,
      correctActions: ['RESPOND_TRUCO:QUIERO'],
    },
  },
  {
    id: 'flor',
    title: 'La flor',
    objective: 'Reconocé cuándo tenés Flor y cantala.',
    steps: [
      'Tenés tres cartas del mismo palo: eso es Flor.',
      'La Flor vale 3 puntos (o más con la regla de la falta).',
      'Cantala antes de que se cierre el envido.',
    ],
    gentleCorrection: 'Con tres cartas del mismo palo siempre conviene cantar Flor.',
    mode: '1v1',
    deal: {
      hands: { '0': ['7-copas', '5-copas', '2-copas'], '1': ['1-espadas', '6-bastos', '4-oros'] },
      manoSeat: 0,
      correctActions: ['CALL_FLOR:FLOR'],
    },
  },
  {
    id: 'senas',
    title: 'Las señas',
    objective: 'Mandale información útil a tu compañero en el 2v2.',
    steps: [
      'En el 2v2 podés hacer una seña por mano antes de jugar.',
      'Con el 1 de espadas, la seña del guiño de ojo avisa que tenés el macho.',
      'Mandá la seña y después jugá tu carta.',
    ],
    gentleCorrection: 'Antes de tirar, mandale al compañero la seña del 1 de espadas.',
    mode: '2v2',
    deal: {
      hands: {
        '0': ['1-espadas', '5-copas', '4-bastos'],
        '1': ['7-oros', '6-oros', '3-copas'],
        '2': ['12-espadas', '2-bastos', '6-copas'],
        '3': ['5-oros', '4-oros', '3-espadas'],
      },
      manoSeat: 0,
      correctActions: ['SEND_SIGNAL:guino_ojo'],
    },
  },
];

export const TUTORIAL_LESSONS: readonly TutorialLesson[] = Object.freeze(LESSONS);

export function lessonById(id: TutorialLessonId): TutorialLesson {
  const found = TUTORIAL_LESSONS.find((lesson) => lesson.id === id);
  if (!found) throw new Error(`Lección desconocida: ${id}`);
  return found;
}
