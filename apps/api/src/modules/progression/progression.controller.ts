import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ProgressionSummarySchema } from '@truco/shared';
import { z } from 'zod';
import { parseWithZod } from '../../common/zod-validation.js';
import { CurrentPrincipal } from '../auth/guards/current-principal.decorator.js';
import {
  type AuthenticatedPrincipal,
  SessionAuthGuard,
} from '../auth/guards/session-auth.guard.js';
import { ProgressionService } from './progression.service.js';

const UuidParamSchema = z.object({ id: z.string().uuid() }).strict();
const CosmeticParamSchema = z.object({ cosmeticId: z.string().min(1).max(64) }).strict();
const NotificationParamSchema = z.object({ notificationId: z.string().uuid() }).strict();

@Controller('me/progression')
@UseGuards(SessionAuthGuard)
export class ProgressionController {
  constructor(@Inject(ProgressionService) private readonly progression: ProgressionService) {}

  @Get()
  async getMine(@CurrentPrincipal() principal: AuthenticatedPrincipal) {
    const result = await this.progression.getSummary(principal.userId);
    return ProgressionSummarySchema.parse(result);
  }

  @Post('missions/:id/claim')
  @HttpCode(HttpStatus.OK)
  async claimMission(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
  ) {
    const { id } = parseWithZod(UuidParamSchema, rawParams);
    const claimed = await this.progression.claimMission(principal.userId, id);
    return {
      claimed,
      progression: ProgressionSummarySchema.parse(
        await this.progression.getSummary(principal.userId),
      ),
    };
  }

  @Post('cosmetics/:cosmeticId/redeem')
  @HttpCode(HttpStatus.OK)
  async redeemCosmetic(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
  ) {
    const { cosmeticId } = parseWithZod(CosmeticParamSchema, rawParams);
    const acquired = await this.progression.redeemCosmetic(principal.userId, cosmeticId);
    return {
      acquired,
      progression: ProgressionSummarySchema.parse(
        await this.progression.getSummary(principal.userId),
      ),
    };
  }

  @Post('notifications/:notificationId/read')
  @HttpCode(HttpStatus.OK)
  async readNotification(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
  ): Promise<{ read: true }> {
    const { notificationId } = parseWithZod(NotificationParamSchema, rawParams);
    await this.progression.readNotification(principal.userId, notificationId);
    return { read: true };
  }
}
