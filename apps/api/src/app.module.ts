import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';

// TODO(STATE-03): Incorporar AuthModule y UsersModule en M3.
// TODO(STATE-04): Incorporar LobbyModule en M4.
// TODO(STATE-07): Incorporar ModerationModule y AdminModule en M7.
// TODO(STATE-08): Incorporar MetricsModule (/v1/metrics) y trazas OpenTelemetry en M8.
@Module({
  imports: [HealthModule],
})
export class AppModule {}
