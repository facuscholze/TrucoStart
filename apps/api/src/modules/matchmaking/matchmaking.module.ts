import { Module } from '@nestjs/common';
import { MatchmakingController } from './matchmaking.controller.js';
import { MatchmakingService } from './matchmaking.service.js';

@Module({
  controllers: [MatchmakingController],
  providers: [MatchmakingService],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
