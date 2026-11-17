import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type AdminAuditListResponse,
  type AdminDashboardMetrics,
  type AdminMatchReplay,
  type AdminReportDetail,
  type AdminReportListResponse,
  type AdminUserDetail,
  type AdminUserListResponse,
  ClaimReportRequestSchema,
  type CreateSanctionRequest,
  CreateSanctionRequestSchema,
  type CreateSanctionResponse,
  type ResolveReportRequest,
  ResolveReportRequestSchema,
} from '@truco/shared';
import type { FastifyRequest } from 'fastify';
import { parseWithZod } from '../../common/zod-validation.js';
import { extractClientMeta } from '../auth/guards/session-auth.guard.js';
import { AdminAuthService, type AdminPrincipal } from './admin-auth.service.js';
import { AdminService } from './admin.service.js';
import { CurrentAdmin } from './guards/current-admin.decorator.js';
import { AdminAuthGuard, RequirePermission } from './guards/admin-auth.guard.js';
import { AdminQueries } from './admin.queries.js';

/** Endpoints del panel. Cada uno exige permiso explícito validado en el servidor. */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly adminService: AdminService,
    @Inject(AdminAuthService) private readonly authService: AdminAuthService,
  ) {}

  @Get('dashboard')
  @RequirePermission('dashboard:read')
  async dashboard(): Promise<AdminDashboardMetrics> {
    return this.adminService.dashboard();
  }

  @Get('users')
  @RequirePermission('users:read')
  async listUsers(
    @CurrentAdmin() principal: AdminPrincipal,
    @Query() query: unknown,
  ): Promise<AdminUserListResponse> {
    const parsed = AdminQueries.users.parse(query);
    return this.adminService.listUsers(principal, parsed);
  }

  @Get('users/:userId')
  @RequirePermission('users:read')
  async userDetail(
    @CurrentAdmin() principal: AdminPrincipal,
    @Param('userId') userId: string,
    @Query() query: unknown,
  ): Promise<AdminUserDetail> {
    const parsed = AdminQueries.reason.parse(query);
    return this.adminService.getUserDetail(principal, userId, parsed.reason);
  }

  @Post('users/:userId/sanctions')
  @RequirePermission('sanctions:issue')
  @HttpCode(HttpStatus.CREATED)
  async sanctionUser(
    @CurrentAdmin() principal: AdminPrincipal,
    @Param('userId') userId: string,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<CreateSanctionResponse> {
    const input = parseWithZod(CreateSanctionRequestSchema, rawBody) as CreateSanctionRequest;
    return this.adminService.sanctionUser(principal, userId, input, extractClientMeta(req).ip);
  }

  @Post('users/:userId/nickname-reset')
  @RequirePermission('nickname:force_change')
  @HttpCode(HttpStatus.OK)
  async forceNickname(
    @CurrentAdmin() principal: AdminPrincipal,
    @Param('userId') userId: string,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ nickname: string; nicknameMustChange: boolean }> {
    const input = AdminQueries.reasonWithBody.parse(rawBody);
    return this.adminService.forceNicknameChange(
      principal,
      userId,
      input.reason,
      extractClientMeta(req).ip,
    );
  }

  @Get('reports')
  @RequirePermission('reports:read')
  async listReports(@Query() query: unknown): Promise<AdminReportListResponse> {
    return this.adminService.listReports(AdminQueries.reports.parse(query));
  }

  @Get('reports/:reportId')
  @RequirePermission('reports:read')
  async reportDetail(@Param('reportId') reportId: string): Promise<AdminReportDetail> {
    return this.adminService.getReportDetail(reportId);
  }

  @Post('reports/:reportId/claim')
  @RequirePermission('reports:claim')
  @HttpCode(HttpStatus.OK)
  async claimReport(
    @CurrentAdmin() principal: AdminPrincipal,
    @Param('reportId') reportId: string,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ version: number }> {
    const input = parseWithZod(ClaimReportRequestSchema, rawBody);
    return this.adminService.claimReport(
      principal,
      reportId,
      input.expectedVersion,
      extractClientMeta(req).ip,
    );
  }

  @Post('reports/:reportId/resolve')
  @RequirePermission('reports:resolve')
  @HttpCode(HttpStatus.OK)
  async resolveReport(
    @CurrentAdmin() principal: AdminPrincipal,
    @Param('reportId') reportId: string,
    @Body() rawBody: unknown,
    @Req() req: FastifyRequest,
  ): Promise<{ status: string; version: number }> {
    const input = parseWithZod(ResolveReportRequestSchema, rawBody) as ResolveReportRequest;
    return this.adminService.resolveReport(principal, reportId, input, extractClientMeta(req).ip);
  }

  @Get('matches/:matchId/replay')
  @RequirePermission('matches:replay')
  async replay(
    @CurrentAdmin() principal: AdminPrincipal,
    @Param('matchId') matchId: string,
    @Query() query: unknown,
    @Req() req: FastifyRequest,
  ): Promise<AdminMatchReplay> {
    const parsed = AdminQueries.reason.parse(query);
    return this.adminService.getMatchReplay(
      principal,
      matchId,
      parsed.reason,
      extractClientMeta(req).ip,
    );
  }

  @Get('audit')
  @RequirePermission('audit:read')
  async audit(@Query() query: unknown): Promise<AdminAuditListResponse> {
    return this.adminService.listAudit(AdminQueries.audit.parse(query));
  }

  @Get('session/permissions')
  async permissions(@CurrentAdmin() principal: AdminPrincipal): Promise<{
    permissions: readonly string[];
    role: string;
    emailMasked: string;
  }> {
    return {
      permissions: principal.permissions,
      role: principal.role,
      emailMasked: this.authService.toSummary(
        {
          id: principal.userId,
          nickname: principal.nickname,
          email: principal.email,
          role: principal.role,
        },
        new Date(),
        principal.permissions,
      ).emailMasked,
    };
  }
}
