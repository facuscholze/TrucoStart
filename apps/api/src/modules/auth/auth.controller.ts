import '@fastify/cookie';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ACCESS_COOKIE_NAME,
  type AuthSessionResponse,
  ForgotPasswordRequestSchema,
  GoogleAuthRequestSchema,
  GuestCreateRequestSchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  type NonEnumeratingAckResponse,
  PromoteGuestRequestSchema,
  REFRESH_COOKIE_NAME,
  RegisterRequestSchema,
  ResendVerificationRequestSchema,
  ResetPasswordRequestSchema,
  type SessionListResponse,
  VerifyEmailRequestSchema,
  type WsTicketResponse,
} from '@truco/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parseWithZod } from '../../common/zod-validation.js';
import { AUTH_RUNTIME_CONFIG, type AuthRuntimeConfig } from './auth.config.js';
import { AuthRecoveryService } from './auth-recovery.service.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { AuthSessionService } from './auth-session.service.js';
import { CurrentPrincipal } from './guards/current-principal.decorator.js';
import {
  type AuthenticatedPrincipal,
  extractClientMeta,
  SessionAuthGuard,
} from './guards/session-auth.guard.js';
import {
  clearAuthCookiesOnReply,
  setAuthCookiesOnReply,
  verifyAccessSessionCookie,
} from './security/token-crypto.js';

const SessionIdParamSchema = z.object({ sessionId: z.string().uuid() });

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AUTH_RUNTIME_CONFIG) private readonly config: AuthRuntimeConfig,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(AuthSessionService) private readonly sessionService: AuthSessionService,
    @Inject(AuthRecoveryService) private readonly recoveryService: AuthRecoveryService,
    @Inject(AuthRepository) private readonly authRepository: AuthRepository,
  ) {}

  @Post('guest')
  @HttpCode(HttpStatus.CREATED)
  async createGuest(
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponse> {
    const input = parseWithZod(GuestCreateRequestSchema, rawBody ?? {});
    const bundle = await this.authService.createGuestSession(input, extractClientMeta(req));
    setAuthCookiesOnReply(reply, {
      accessToken: bundle.accessCookie,
      refreshToken: bundle.refreshCookie,
      config: this.config.cookieConfig,
    });
    return bundle.response;
  }

  @Post('promote-guest')
  @UseGuards(SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  async promoteGuest(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponse> {
    const input = parseWithZod(PromoteGuestRequestSchema, rawBody);
    const bundle = await this.authService.promoteGuest(principal, input, extractClientMeta(req));
    setAuthCookiesOnReply(reply, {
      accessToken: bundle.accessCookie,
      refreshToken: bundle.refreshCookie,
      config: this.config.cookieConfig,
    });
    return bundle.response;
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponse> {
    const input = parseWithZod(RegisterRequestSchema, rawBody);
    const bundle = await this.authService.register(input, extractClientMeta(req));
    setAuthCookiesOnReply(reply, {
      accessToken: bundle.accessCookie,
      refreshToken: bundle.refreshCookie,
      config: this.config.cookieConfig,
    });
    return bundle.response;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponse> {
    const input = parseWithZod(LoginRequestSchema, rawBody);
    const bundle = await this.authService.login(input, extractClientMeta(req));
    setAuthCookiesOnReply(reply, {
      accessToken: bundle.accessCookie,
      refreshToken: bundle.refreshCookie,
      config: this.config.cookieConfig,
    });
    return bundle.response;
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  async loginGoogle(
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponse> {
    const input = parseWithZod(GoogleAuthRequestSchema, rawBody);
    const bundle = await this.authService.loginWithGoogle(input, extractClientMeta(req));
    setAuthCookiesOnReply(reply, {
      accessToken: bundle.accessCookie,
      refreshToken: bundle.refreshCookie,
      config: this.config.cookieConfig,
    });
    return bundle.response;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthSessionResponse> {
    const rawRefresh = req.cookies?.[REFRESH_COOKIE_NAME];
    try {
      const bundle = await this.sessionService.refreshSession(rawRefresh, extractClientMeta(req));
      setAuthCookiesOnReply(reply, {
        accessToken: bundle.accessCookie,
        refreshToken: bundle.refreshCookie,
        config: this.config.cookieConfig,
      });
      return bundle.response;
    } catch (err) {
      clearAuthCookiesOnReply(reply, this.config.cookieConfig);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<NonEnumeratingAckResponse> {
    const input = parseWithZod(LogoutRequestSchema, rawBody ?? {});
    let principal: AuthenticatedPrincipal | null = null;
    const rawAccess = req.cookies?.[ACCESS_COOKIE_NAME];
    const claims = verifyAccessSessionCookie(
      rawAccess,
      this.config.sessionSecret,
      this.config.nowFn(),
    );
    if (claims) {
      const s = await this.authRepository.findSessionById(claims.sessionId);
      const u = await this.authRepository.findUserById(claims.userId);
      if (s && u) {
        principal = {
          userId: u.id,
          sessionId: s.id,
          familyId: s.familyId,
          nickname: u.nickname,
          email: u.email,
          isGuest: u.isGuest,
          emailVerified: u.emailVerifiedAt !== null,
          role: u.role,
        };
      }
    }

    await this.sessionService.logout(
      principal,
      req.cookies?.[REFRESH_COOKIE_NAME],
      input,
      extractClientMeta(req),
    );
    clearAuthCookiesOnReply(reply, this.config.cookieConfig);
    return { accepted: true, message: 'Sesión cerrada correctamente.' };
  }

  @Get('sessions')
  @UseGuards(SessionAuthGuard)
  async listSessions(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
  ): Promise<SessionListResponse> {
    const sessions = await this.sessionService.listSessions(principal);
    return { sessions };
  }

  @Delete('sessions/:sessionId')
  @UseGuards(SessionAuthGuard)
  async revokeSession(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Param() rawParams: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<NonEnumeratingAckResponse> {
    const { sessionId } = parseWithZod(SessionIdParamSchema, rawParams);
    await this.sessionService.revokeSessionById(principal, sessionId, extractClientMeta(req));
    if (sessionId === principal.sessionId) {
      clearAuthCookiesOnReply(reply, this.config.cookieConfig);
    }
    return { accepted: true, message: 'Sesión revocada.' };
  }

  @Post('forgot')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<NonEnumeratingAckResponse> {
    const input = parseWithZod(ForgotPasswordRequestSchema, rawBody);
    return this.recoveryService.requestPasswordReset(input, extractClientMeta(req));
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<NonEnumeratingAckResponse> {
    const input = parseWithZod(ResetPasswordRequestSchema, rawBody);
    const res = await this.recoveryService.confirmPasswordReset(input, extractClientMeta(req));
    clearAuthCookiesOnReply(reply, this.config.cookieConfig);
    return res;
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<NonEnumeratingAckResponse> {
    const input = parseWithZod(VerifyEmailRequestSchema, rawBody);
    return this.recoveryService.verifyEmail(input, extractClientMeta(req));
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<NonEnumeratingAckResponse> {
    const input = parseWithZod(ResendVerificationRequestSchema, rawBody);
    return this.recoveryService.resendVerificationEmail(input, extractClientMeta(req));
  }

  @Post('ws-ticket')
  @UseGuards(SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  async issueWsTicket(
    @CurrentPrincipal() principal: AuthenticatedPrincipal,
    @Req() req: FastifyRequest,
  ): Promise<WsTicketResponse> {
    return this.sessionService.issueWsTicket(principal, extractClientMeta(req));
  }
}
