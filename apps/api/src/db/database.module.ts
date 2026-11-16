import {
  type DynamicModule,
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  createPgliteDatabase,
  createPostgresDatabase,
  type DatabaseConnectionHandle,
  DB_CONNECTION_HANDLE,
  DRIZZLE_DB,
} from './database.provider.js';

@Global()
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(DB_CONNECTION_HANDLE) private readonly connectionHandle: DatabaseConnectionHandle,
  ) {}

  static registerFromHandle(handle: DatabaseConnectionHandle): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        { provide: DB_CONNECTION_HANDLE, useValue: handle },
        { provide: DRIZZLE_DB, useValue: handle.db },
      ],
      exports: [DB_CONNECTION_HANDLE, DRIZZLE_DB],
    };
  }

  static registerAsyncFromEnv(databaseUrl?: string): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        {
          provide: DB_CONNECTION_HANDLE,
          useFactory: async (): Promise<DatabaseConnectionHandle> => {
            if (databaseUrl && databaseUrl.trim().length > 0) {
              return createPostgresDatabase({ databaseUrl, runMigrations: true });
            }
            return createPgliteDatabase();
          },
        },
        {
          provide: DRIZZLE_DB,
          useFactory: (handle: DatabaseConnectionHandle) => handle.db,
          inject: [DB_CONNECTION_HANDLE],
        },
      ],
      exports: [DB_CONNECTION_HANDLE, DRIZZLE_DB],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.connectionHandle.close();
  }
}
