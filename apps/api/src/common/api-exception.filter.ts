import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { createApiErrorResponse, type ErrorCode } from '@truco/shared';
import type { FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { DomainApiException } from './api-exception.js';

function mapStatusToErrorCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_ERROR';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 423:
      return 'ACCOUNT_LOCKED';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL_ERROR';
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (exception instanceof DomainApiException) {
      if (
        exception.code === 'RATE_LIMITED' &&
        typeof exception.details?.['retryAfterMs'] === 'number'
      ) {
        const secs = Math.max(1, Math.ceil((exception.details['retryAfterMs'] as number) / 1000));
        reply.header('Retry-After', String(secs));
      }
      reply
        .status(exception.getStatus())
        .send(createApiErrorResponse(exception.code, exception.message, exception.details));
      return;
    }

    if (exception instanceof ZodError) {
      reply.status(HttpStatus.BAD_REQUEST).send(
        createApiErrorResponse('VALIDATION_ERROR', 'Los datos enviados no son válidos', {
          issues: exception.issues.map((i) => ({
            path: i.path.map(String).join('.'),
            message: i.message,
          })),
        }),
      );
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        typeof raw === 'string'
          ? raw
          : typeof (raw as Record<string, unknown>)['message'] === 'string'
            ? ((raw as Record<string, unknown>)['message'] as string)
            : exception.message;
      reply.status(status).send(createApiErrorResponse(mapStatusToErrorCode(status), message));
      return;
    }

    reply
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .send(createApiErrorResponse('INTERNAL_ERROR', 'Error interno del servidor'));
  }
}
