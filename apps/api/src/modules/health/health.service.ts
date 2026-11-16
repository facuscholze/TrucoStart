import { Injectable } from '@nestjs/common';
import { DEFAULT_APP_NAME, type HealthResponse } from '@truco/shared';

@Injectable()
export class HealthService {
  getLiveness(appName = DEFAULT_APP_NAME): HealthResponse {
    return {
      status: 'ok',
      service: 'api',
      appName,
      timestamp: new Date().toISOString(),
    };
  }

  getReadiness(appName = DEFAULT_APP_NAME): HealthResponse {
    // TODO(STATE-03): Verificar conectividad activa con PostgreSQL y Redis al incorporar Drizzle e ioredis en M3.
    return {
      status: 'ok',
      service: 'api',
      appName,
      timestamp: new Date().toISOString(),
    };
  }
}
