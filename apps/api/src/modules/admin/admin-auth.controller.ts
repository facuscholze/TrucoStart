import '@fastify/cookie';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type AdminLoginRequest,
  AdminLoginRequestSchema,
  type AdminLoginResponse,
} from '@truco/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseWithZod } from '../../common/zod-validation.js';
import { extractClientMeta } from '../auth/guards/session-auth.guard.js';
import { AdminAuthService, ADMIN_SESSION_COOKIE } from './admin-auth.service.js';
import { ADMIN_RUNTIME_CONFIG, type AdminRuntimeConfig } from './admin.config.js';
import { AdminAuthGuard, assertAdminNetworkAllowed } from './guards/admin-auth.guard.js';
import { CurrentAdmin } from './guards/current-admin.decorator.js';
import type { AdminPrincipal } from './admin-auth.service.js';

/** Autenticación del panel: cookie separada, TTL corto y 2FA obligatorio. */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    @Inject(AdminAuthService) private readonly authService: AdminAuthService,
    @Inject(ADMIN_RUNTIME_CONFIG) private readonly config: AdminRuntimeConfig,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminLoginResponse> {
    assertAdminNetworkAllowed(req.ip, this.config);
    const input = parseWithZod(AdminLoginRequestSchema, rawBody) as AdminLoginRequest;
    const bundle = await this.authService.login(input, extractClientMeta(req));
    this.authService.applyCookie(reply, bundle.cookieValue, bundle.cookieMaxAgeSeconds);
    return { session: bundle.session };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.authService.logout(req.cookies?.[ADMIN_SESSION_COOKIE], extractClientMeta(req).ip);
    this.authService.clearCookie(reply);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AdminAuthGuard)
  me(@CurrentAdmin() principal: AdminPrincipal): AdminLoginResponse {
    return {
      session: {
        userId: principal.userId,
        nickname: principal.nickname,
        role: principal.role,
        permissions: [...principal.permissions],
        emailMasked: principal.email ?? '',
        expiresAt: new Date(
          this.config.nowFn() + this.config.sessionTtlSeconds * 1000,
        ).toISOString(),
        twoFactorEnabled: true,
      },
    };
  }
}
