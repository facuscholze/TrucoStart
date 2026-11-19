import { z } from 'zod';

export const HealthStatusSchema = z.enum(['ok', 'degraded', 'draining']);

export const HealthResponseSchema = z.object({
  status: HealthStatusSchema,
  service: z.string().min(1),
  appName: z.string().min(1),
  timestamp: z.string().datetime(),
  /**
   * IP del cliente tal como la resolvió el servicio (ADR-020). Se publica en la
   * liveness para poder verificar, desde el borde, que las cabeceras de proxy
   * falsificadas no alteran el origen. En liveness la IP viene resuelta por el
   * propio servidor, no por un valor que el cliente pueda fijar.
   */
  clientIp: z.string().min(1).optional(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
