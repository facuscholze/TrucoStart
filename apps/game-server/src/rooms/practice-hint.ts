import { type Action, chooseBotAction, getTrucoPower, type PlayerView } from '@truco/engine';

export interface PracticeHint {
  readonly suggestedAction: string;
  readonly explanation: string;
}

/**
 * Textos de las pistas de entrenamiento (frases rioplatense de una línea).
 * Centralizados acá para que la UI no replique lógica ni redacción.
 */
const HINTS = {
  playHighCard: (card: string) => `Tirá el ${card}: es tu carta más fuerte y te asegura la baza.`,
  playLowestSufficient: (card: string) =>
    `Tirá el ${card}: gana la baza con lo justo y te guarda las cartas altas.`,
  playLowest: (card: string) => `Soltá el ${card}, que es la más baja y ya no sirve acá.`,
  callEnvido: (tanto: number, points: number) =>
    `Tenés ${tanto} de envido, conviene cantarlo: son ${points} puntos casi seguros.`,
  raiseEnvido: (tanto: number) =>
    `Con ${tanto} de envido conviene subir a Real Envido: duplicás lo que hay en juego.`,
  respondEnvidoYes: (tanto: number) => `Tenés ${tanto} de envido: decile "Quiero" y jugálo.`,
  respondEnvidoNo: (tanto: number) =>
    `Con ${tanto} de envido no llegás: decile "No quiero" y guardá la plata.`,
  callTruco: (strength: number) =>
    `Tu mano gana el ${Math.round(strength * 100)}% de las veces: cantá Truco ahora.`,
  respondTrucoYes: (strength: number) =>
    `Tu mano gana el ${Math.round(strength * 100)}% de las veces: decile "Quiero" al Truco.`,
  respondTrucoNo: (strength: number) =>
    `Tu mano gana apenas el ${Math.round(strength * 100)}%: es mejor decir "No quiero".`,
  callFlor: () => 'Tenés Flor: cantala, son tres puntos que no se discuten.',
  respondFlorYes: () => 'Tenés Flor alta: decile "Con Flor quiero" y sumá los puntos.',
  respondFlorNo: () => 'Tu Flor es baja: conviene achicarte y no arriesgar.',
  sendSignal: () => 'Mandale la seña al compañero antes de jugar: es información gratis.',
  fold: () => 'La mano está perdida: irte al mazo ahora te ahorra puntos.',
  generic: () => 'Jugá tranquilo: mirá primero qué cartas ya salieron antes de decidir.',
} as const;

function cardLabel(view: PlayerView, cardId: string): string {
  const card = [...view.hand.myRemainingCards, ...view.hand.myInitialCards].find(
    (c) => c.id === cardId,
  );
  if (!card) return cardId;
  const suitName = { espadas: 'espadas', bastos: 'bastos', oros: 'oros', copas: 'copas' }[
    card.suit
  ];
  const rank =
    card.rank === 10 ? 'sota' : card.rank === 11 ? 'caballo' : card.rank === 12 ? 'rey' : null;
  return rank ? `${rank} de ${suitName}` : `${card.rank} de ${suitName}`;
}

function codeForAction(action: Action): string {
  if (action.type === 'PLAY_CARD') return `PLAY_CARD:${action.cardId}`;
  if (action.type === 'CALL_ENVIDO') return `CALL_ENVIDO:${action.bid}`;
  if (action.type === 'RESPOND_ENVIDO') return `RESPOND_ENVIDO:${action.decision}`;
  if (action.type === 'CALL_TRUCO') return `CALL_TRUCO:${action.bid}`;
  if (action.type === 'RESPOND_TRUCO') return `RESPOND_TRUCO:${action.decision}`;
  if (action.type === 'CALL_FLOR') return `CALL_FLOR:${action.bid}`;
  if (action.type === 'RESPOND_FLOR') return `RESPOND_FLOR:${action.decision}`;
  if (action.type === 'SEND_SIGNAL') return `SEND_SIGNAL:${action.signalId}`;
  return action.type;
}

/**
 * Pista de entrenamiento calculada SIEMPRE del lado del servidor y solo para mesas de práctica.
 * Se apoya en la IA difícil (que únicamente ve `viewFor(state, seat)`) y traduce la jugada a una
 * frase rioplatense con el "por qué" en una línea.
 */
export function buildPracticeHint(params: {
  readonly view: PlayerView;
  readonly envidoTanto: number;
  readonly handStrength: number;
  readonly trucoPoints?: number;
}): PracticeHint {
  const { view } = params;
  const action = chooseBotAction(view, undefined, 'HARD');
  const strength = params.handStrength;

  switch (action.type) {
    case 'PLAY_CARD': {
      const label = cardLabel(view, action.cardId);
      const chosen = view.hand.myRemainingCards.find((card) => card.id === action.cardId);
      const chosenPower = chosen ? getTrucoPower(chosen) : 0;
      const maxPower = view.hand.myRemainingCards.reduce(
        (best, card) => Math.max(best, getTrucoPower(card)),
        0,
      );
      return {
        suggestedAction: codeForAction(action),
        explanation:
          chosenPower >= maxPower ? HINTS.playHighCard(label) : HINTS.playLowestSufficient(label),
      };
    }
    case 'CALL_ENVIDO':
      return {
        suggestedAction: codeForAction(action),
        explanation:
          action.bid === 'ENVIDO'
            ? HINTS.callEnvido(params.envidoTanto, 2)
            : HINTS.raiseEnvido(params.envidoTanto),
      };
    case 'RESPOND_ENVIDO':
      return {
        suggestedAction: codeForAction(action),
        explanation:
          action.decision === 'QUIERO'
            ? HINTS.respondEnvidoYes(params.envidoTanto)
            : HINTS.respondEnvidoNo(params.envidoTanto),
      };
    case 'CALL_TRUCO':
      return { suggestedAction: codeForAction(action), explanation: HINTS.callTruco(strength) };
    case 'RESPOND_TRUCO':
      return {
        suggestedAction: codeForAction(action),
        explanation:
          action.decision === 'QUIERO'
            ? HINTS.respondTrucoYes(strength)
            : HINTS.respondTrucoNo(strength),
      };
    case 'CALL_FLOR':
      return { suggestedAction: codeForAction(action), explanation: HINTS.callFlor() };
    case 'RESPOND_FLOR':
      return {
        suggestedAction: codeForAction(action),
        explanation:
          action.decision === 'CON_FLOR_QUIERO' ? HINTS.respondFlorYes() : HINTS.respondFlorNo(),
      };
    case 'SEND_SIGNAL':
      return { suggestedAction: codeForAction(action), explanation: HINTS.sendSignal() };
    case 'FOLD_HAND':
      return { suggestedAction: codeForAction(action), explanation: HINTS.fold() };
    default:
      return { suggestedAction: codeForAction(action), explanation: HINTS.generic() };
  }
}
