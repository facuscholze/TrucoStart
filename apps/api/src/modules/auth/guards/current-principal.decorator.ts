import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { DomainApiException } from '../../../common/api-exception.js';
import type { AuthenticatedFastifyRequest, AuthenticatedPrincipal } from './session-auth.guard.js';

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedFastifyRequest>();
    if (!req.principal) {
      throw new DomainApiException(401, 'UNAUTHORIZED', 'Autenticación requerida');
    }
    return req.principal;
  },
);
