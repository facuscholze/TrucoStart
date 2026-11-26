import { Global, Module } from '@nestjs/common';
import { SocialController } from './social.controller.js';
import { SocialRepository } from './social.repository.js';
import { SocialService } from './social.service.js';

@Global()
@Module({
  controllers: [SocialController],
  providers: [SocialRepository, SocialService],
  exports: [SocialRepository, SocialService],
})
export class SocialModule {}
