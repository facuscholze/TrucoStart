import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@truco/shared';

export class DomainApiException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super({ code, message, details }, statusCode);
    this.code = code;
    this.details = details;
  }
}
