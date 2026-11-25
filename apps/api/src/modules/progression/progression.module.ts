import { Module } from '@nestjs/common';
import { ProgressionController } from './progression.controller.js';
import { ProgressionService } from './progression.service.js';

@Module({
  controllers: [ProgressionController],
  providers: [ProgressionService],
  exports: [ProgressionService],
})
export class ProgressionModule {}
