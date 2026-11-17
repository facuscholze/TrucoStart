import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { DEFAULT_APP_NAME, type HealthResponse } from '@truco/shared';
import { type DatabaseConnectionHandle, DB_CONNECTION_HANDLE } from '../../db/database.provider.js';

@Injectable()
export class HealthService {
  constructor(
    @Optional()
    @Inject(DB_CONNECTION_HANDLE)
    private readonly dbHandle?: DatabaseConnectionHandle,
  ) {}

  getLiveness(appName = DEFAULT_APP_NAME): HealthResponse {
    return {
      status: 'ok',
      service: 'api',
      appName,
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(appName = DEFAULT_APP_NAME): Promise<HealthResponse> {
    if (this.dbHandle) {
      const ok = await this.dbHandle.checkReady();
      if (!ok) {
        throw new ServiceUnavailableException('Base de datos no disponible');
      }
    }
    return {
      status: 'ok',
      service: 'api',
      appName,
      timestamp: new Date().toISOString(),
    };
  }
}
