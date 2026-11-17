import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AdminPrincipal } from '../admin-auth.service.js';
import type { AdminFastifyRequest } from './admin-auth.guard.js';

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminPrincipal => {
    const req = context.switchToHttp().getRequest<AdminFastifyRequest>();
    if (!req.adminPrincipal) {
      throw new Error('CurrentAdmin requiere AdminAuthGuard');
    }
    return req.adminPrincipal;
  },
);
