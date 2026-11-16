import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type MatchmakingCancelResponse,
  MatchmakingEnqueueRequestSchema,
  type MatchmakingQueueStatusResponse,
} from '@truco/shared';
import type { FastifyReply } from 'fastify';
import { parseWithZod } from '../../common/zod-validation.js';
import { CurrentPrincipal } from '../auth/guards/current-principal.decorator.js';
import {
  type AuthenticatedPrincipal,
  SessionAuthGuard,
} from '../auth/guards/session-auth.guard.js';
import { MatchmakingService } from './matchmaking.service.js';

@Controller('matchmaking/queue')
@UseGuards(SessionAuthGuard)
export class MatchmakingController {
  constructor(
    @Inject(MatchmakingService) private readonly matchmakingService: MatchmakingService,
  ) {}

  @Get()
  async getQueueStatus(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<MatchmakingQueueStatusResponse> {
    return this.matchmakingService.getQueueStatus(principal);
  }

  @Post()
  async enqueue(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MatchmakingQueueStatusResponse> {
    const body = parseWithZod(MatchmakingEnqueueRequestSchema, rawBody ?? {});
    const res = await this.matchmakingService.enqueue(principal, body);
    reply.status(res.httpStatus);
    return res.payload;
  }

  @Delete()
  @HttpCode(200)
  async cancelQueue(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<MatchmakingCancelResponse> {
    return this.matchmakingService.cancelQueue(principal);
  }
}
