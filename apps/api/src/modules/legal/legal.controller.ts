import { Controller, Get, Inject } from '@nestjs/common';
import type { LegalStatusResponse } from '@truco/shared';
import { LegalService } from './legal.service.js';

/**
 * Endpoint público (sin sesión): la web necesita la edad mínima y las versiones
 * vigentes ANTES de que la persona tenga cuenta.
 */
@Controller('legal')
export class LegalController {
  constructor(@Inject(LegalService) private readonly legalService: LegalService) {}

  @Get()
  status(): LegalStatusResponse {
    return this.legalService.getStatus();
  }
}
