import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { UsersRepository } from './users.repository.js';
import { ProgressionModule } from '../progression/progression.module.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [ProgressionModule],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
