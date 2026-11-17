#!/usr/bin/env node
/**
 * Genera `docs/BOT_DECISION_LOG.md`: log de decisiones de una partida difícil vs difícil
 * (semilla fija) con lo que el bot ve en cada turno desde su `PlayerView`.
 *
 * Uso: node packages/truco-engine/scripts/m6-decision-log.mjs
 * Requisito: `pnpm --filter @truco/engine build` (usa `dist/`).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AR_STANDARD_V1,
  BOT_DIFFICULTY_PARAMS,
  chooseBotAction,
  scoreEnvido,
  simulateMatch,
} from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const OUT_FILE = path.join(REPO_ROOT, 'docs/BOT_DECISION_LOG.md');
const SEED = 20260101;
const params = BOT_DIFFICULTY_PARAMS.HARD;

const label = (cards) =>
  cards
    .map((card) => `${card.rank} de ${card.suit}`)
    .join(', ')
    .replaceAll('espadas', 'esp.')
    .replaceAll('bastos', 'bast.')
    .replaceAll('copas', 'copas')
    .replaceAll('oros', 'oros');

const rows = [];

const loggingHardBot = (view, rng) => {
  const action = chooseBotAction(view, rng, params);
  if (view.mySeat === 0) {
    const hand = view.hand;
    const cards = hand.myRemainingCards;
    const initial = hand.myInitialCards.length > 0 ? hand.myInitialCards : cards;
    const legal = view.legalActions.map((candidate) => candidate.type);
    rows.push({
      hand: hand.handNumber,
      cards: label(cards),
      tanto: initial.length >= 2 ? String(scoreEnvido(initial)) : '—',
      score: `${view.scoresByTeam['0'] ?? 0}-${view.scoresByTeam['1'] ?? 0}`,
      turn: `${hand.currentRoundIndex + 1}`,
      pending: describePending(hand),
      action: describeAction(action),
      legal: [...new Set(legal)].join(' / '),
    });
  }
  return action;
};

function describePending(hand) {
  if (hand.truco?.pending) return hand.truco.pending.bid ?? hand.truco.pending.family ?? 'TRUCO';
  if (hand.envidoChain && hand.envidoStatus !== 'RESOLVED') return 'ENVIDO';
  if (hand.florChain && hand.florStatus !== 'RESOLVED') return 'FLOR';
  return '—';
}

function describeAction(action) {
  if (action.type === 'PLAY_CARD') return `juega ${action.cardId}`;
  if (action.type === 'CALL_ENVIDO') return `canta ${action.bid}`;
  if (action.type === 'CALL_TRUCO') return `canta ${action.bid}`;
  if (action.type === 'CALL_FLOR') return `canta ${action.bid}`;
  if (action.type === 'RESPOND_ENVIDO') return `responde ${action.decision}`;
  if (action.type === 'RESPOND_TRUCO') return `responde ${action.decision}`;
  if (action.type === 'RESPOND_FLOR') return `responde ${action.decision}`;
  if (action.type === 'SEND_SIGNAL') return `seña ${action.signalId}`;
  if (action.type === 'FOLD_HAND') return 'se va al mazo';
  return action.type;
}

const result = simulateMatch({
  ruleset: AR_STANDARD_V1,
  numSeats: 2,
  seed: SEED,
  agentByTeam: { 0: loggingHardBot, 1: 'HARD' },
});

const calls = rows.filter(
  (row) => row.action.startsWith('canta') || row.action.startsWith('responde'),
);
const trucoCalls = rows.filter((row) => /truco|retruco|vale cuatro/i.test(row.action));
const envidoCalls = rows.filter((row) => /envido/i.test(row.action));
const lines = [];

lines.push('# Log de decisiones — bot difícil vs bot difícil (M6)');
lines.push('');
lines.push(
  'Partida 1v1 completa simulada con `simulateMatch` (semilla `' +
    SEED +
    '`, `AR_STANDARD_V1`), con el bot **difícil** en el equipo 0. En cada turno el bot recibe únicamente su `PlayerView` (su mano, cartas ya jugadas, marcador y cantos), y las decisiones se toman con los parámetros `BOT_DIFFICULTY_PARAMS.HARD`.',
);
lines.push('');
lines.push('## Resultado');
lines.push('');
lines.push(
  `- Ganador: **equipo ${result.winnerTeam}** en ${result.handsPlayed} manos y ${result.actionsApplied} acciones.`,
);
lines.push(
  `- Marcador final: **${result.finalState.scoresByTeam['0']} - ${result.finalState.scoresByTeam['1']}**.`,
);
lines.push(
  `- Decisiones registradas del bot difícil: **${rows.length}** (cantos: ${calls.length}, truco: ${trucoCalls.length}, envido: ${envidoCalls.length}).`,
);
lines.push('');
lines.push('## Parámetros usados');
lines.push('');
lines.push('| Parámetro | Valor |');
lines.push('| --- | --- |');
for (const [key, value] of Object.entries(params)) {
  lines.push(`| \`${key}\` | \`${String(value)}\` |`);
}
lines.push('');
lines.push('## Decisiones (primeras 40)');
lines.push('');
lines.push(
  '| # | Mano | Baza | Cartas en mano | Envido | Marcador | Canto pendiente | Acción elegida |',
);
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
rows.slice(0, 40).forEach((row, index) => {
  lines.push(
    `| ${index + 1} | ${row.hand} | ${row.turn} | ${row.cards} | ${row.tanto} | ${row.score} | ${row.pending} | ${row.action} |`,
  );
});
lines.push('');
lines.push('### Lectura de las decisiones');
lines.push('');
lines.push(
  `- **Envido:** cantó ${envidoCalls.length} veces; el bot solo canta con tanto alto (umbral \`envidoCallThreshold = ${params.envidoCallThreshold}\`) y con la probabilidad de ganar la baza a favor.`,
);
lines.push(
  `- **Truco:** aceptó cuando su fuerza estimada superaba \`trucoAcceptStrength = ${params.trucoAcceptStrength}\` y subió el canto por encima de \`trucoRaiseStrength = ${params.trucoRaiseStrength}\`, mirando además el marcador (con el rival cerca del objetivo es más barato aceptar).`,
);
lines.push(
  `- **Cartas:** juega la carta mínima que le alcanza para ganar la baza (nunca quema el ancho si una carta baja sirve) y guarda la más alta para la tercera cuando la mano está pareja.`,
);
lines.push(
  `- **Memoria:** todas las estimaciones usan cartas ya vistas en la mesa y descartes del rival, nunca el mazo oculto; el bot no recibe información privada de otros asientos.`,
);
lines.push('');

await mkdir(path.dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, lines.join('\n'), 'utf8');
console.log(
  `✓ ${path.relative(REPO_ROOT, OUT_FILE)} (${rows.length} decisiones, ganador equipo ${result.winnerTeam})`,
);
