import { z } from 'zod';

export const QUICK_CHAT_PHRASES = [
  { id: 'buenas', text: '¡Buenas!', category: 'saludo' },
  { id: 'suerte', text: '¡Suerte a todos!', category: 'saludo' },
  { id: 'cantalo', text: '¡Cantalo si te animás!', category: 'picardia' },
  { id: 'mentiroso', text: '¡Qué mentiroso!', category: 'picardia' },
  { id: 'parda_la_mejor', text: '¡A parda la mejor!', category: 'juego' },
  { id: 'paso_compa', text: 'Voy al pie, compañero.', category: 'equipo' },
  { id: 'bien_jugada', text: '¡Bien jugada!', category: 'respeto' },
  { id: 'otra_vuelta', text: '¿Sale la revancha?', category: 'respeto' },
  { id: 'emote_mate', text: '🧉', category: 'emote' },
  { id: 'emote_aplauso', text: '👏', category: 'emote' },
] as const;

export const QuickChatPhraseIdSchema = z.enum([
  'buenas',
  'suerte',
  'cantalo',
  'mentiroso',
  'parda_la_mejor',
  'paso_compa',
  'bien_jugada',
  'otra_vuelta',
  'emote_mate',
  'emote_aplauso',
]);

export type QuickChatPhraseId = z.infer<typeof QuickChatPhraseIdSchema>;
