import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type CreateReportRequest,
  CreateReportRequestSchema,
  type CreateReportResponse,
  type MyModerationState,
} from '@truco/shared';
import type { FastifyRequest } from 'fastify';
import { parseWithZod } from '../../common/zod-validation.js';
import {
  type AuthenticatedPrincipal,
  extractClientMeta,
  SessionAuthGuard,
} from '../auth/guards/session-auth.guard.js';
import { CurrentPrincipal } from '../auth/guards/current-principal.decorator.js';
import { ModerationService } from './moderation.service.js';

/** Reportes del jugador y su propio estado de moderación. */
@Controller('me')
@UseGuards(SessionAuthGuard)
export class ModerationController {
  constructor(@Inject(ModerationService) private readonly moderationService: ModerationService) {}

  @Post('reports')
  @HttpCode(HttpStatus.CREATED)
  async createReport(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<CreateReportResponse> {
    const input = parseWithZod(CreateReportRequestSchema, rawBody) as CreateReportRequest;
    return this.moderationService.createReport(principal, input, extractClientMeta(req).ip);
  }

  @Get('moderation')
  async myModerationState(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<MyModerationState> {
    return this.moderationService.getMyModerationState(principal);
  }
}
