import { Controller, Get } from '@nestjs/common';
import { buildOpenApiV1Document, type OpenApiDocument } from './openapi.document.js';

@Controller()
export class OpenApiController {
  @Get('openapi.json')
  getOpenApiSpec(): OpenApiDocument {
    return buildOpenApiV1Document();
  }
}
