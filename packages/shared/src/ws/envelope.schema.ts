import { z } from 'zod';

export const ClientEventTypeSchema = z.enum([
  'table.join',
  'table.leave',
  'table.ready',
  'game.playCard',
  'game.call',
  'game.respond',
  'game.foldHand',
  'game.signal',
  'chat.quick',
  'game.rejoin',
]);

export const ServerEventTypeSchema = z.enum([
  'table.state',
  'game.started',
  'game.dealt',
  'game.turn',
  'game.cardPlayed',
  'game.callMade',
  'game.callResolved',
  'game.handEnded',
  'game.scoreUpdated',
  'game.ended',
  'player.disconnected',
  'player.reconnected',
  'game.resync',
  'error',
]);

export type ClientEventType = z.infer<typeof ClientEventTypeSchema>;
export type ServerEventType = z.infer<typeof ServerEventTypeSchema>;

export const WsEnvelopeSchema = z.object({
  eventId: z.string().min(8).max(128),
  seq: z.number().int().nonnegative().optional(),
  ts: z.number().int().positive(),
  type: z.union([ClientEventTypeSchema, ServerEventTypeSchema]),
  payload: z.record(z.string(), z.unknown()),
});

export type WsEnvelope = z.infer<typeof WsEnvelopeSchema>;

export function createWsEnvelopeSchema<TPayload extends z.ZodTypeAny>(
  typeSchema: z.ZodType<ClientEventType | ServerEventType>,
  payloadSchema: TPayload,
) {
  return z.object({
    eventId: z.string().min(8).max(128),
    seq: z.number().int().nonnegative().optional(),
    ts: z.number().int().positive(),
    type: typeSchema,
    payload: payloadSchema,
  });
}
