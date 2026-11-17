import '@fastify/cookie';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminPermission } from '@truco/shared';
import type { FastifyRequest } from 'fastify';
import { DomainApiException } from '../../../common/api-exception.js';
import {
  AdminAuthService,
  ADMIN_SESSION_COOKIE,
  type AdminPrincipal,
} from '../admin-auth.service.js';

export const ADMIN_PERMISSION_METADATA = 'admin:permission';

/** Declara el permiso que exige un endpoint. Se valida en el servidor, nunca en el cliente. */
export const RequirePermission = (permission: AdminPermission): MethodDecorator =>
  SetMetadata(ADMIN_PERMISSION_METADATA, permission);

export interface AdminFastifyRequest extends FastifyRequest {
  adminPrincipal?: AdminPrincipal;
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    @Inject(AdminAuthService) private readonly authService: AdminAuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminFastifyRequest>();
    const rawCookie = req.cookies?.[ADMIN_SESSION_COOKIE];
    const principal = await this.authService.authenticate(rawCookie);

    const required = this.reflector.getAllAndOverride<AdminPermission | undefined>(
      ADMIN_PERMISSION_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (required && !principal.permissions.includes(required)) {
      throw new DomainApiException(403, 'FORBIDDEN', 'Tu rol no tiene permiso para esta acción.', {
        reason: 'ADMIN_PERMISSION_DENIED',
        requiredPermission: required,
        role: principal.role,
      });
    }

    req.adminPrincipal = principal;
    return true;
  }
}
