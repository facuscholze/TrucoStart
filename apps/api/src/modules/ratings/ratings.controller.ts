import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import {
  LeaderboardQuerySchema,
  type LeaderboardResponse,
  type PlayerRatingResponse,
} from '@truco/shared';
import { z } from 'zod';
import { parseWithZod } from '../../common/zod-validation.js';
import { CurrentPrincipal } from '../auth/guards/current-principal.decorator.js';
import {
  type AuthenticatedPrincipal,
  SessionAuthGuard,
} from '../auth/guards/session-auth.guard.js';
import { RatingsService } from './ratings.service.js';

const UserIdParamSchema = z.object({ id: z.string().uuid() }).strict();

@Controller()
export class RatingsController {
  constructor(@Inject(RatingsService) private readonly ratingsService: RatingsService) {}

  /** Rankings públicos incluyen solamente usuarios con estadísticas visibles para todos. */
  @Get('rankings')
  async list(@Query() rawQuery: unknown): Promise<LeaderboardResponse> {
    const query = parseWithZod(LeaderboardQuerySchema, rawQuery ?? {});
    return this.ratingsService.getLeaderboard(query);
  }

  @Get('users/:id/ratings')
  @UseGuards(SessionAuthGuard)
  async playerRatings(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
  ): Promise<PlayerRatingResponse> {
    const { id } = parseWithZod(UserIdParamSchema, rawParams);
    return this.ratingsService.getPlayerRatingProfiles(id, principal.userId);
  }
}
