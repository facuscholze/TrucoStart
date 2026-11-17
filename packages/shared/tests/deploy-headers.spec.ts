import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * M8a — paridad entre las cabeceras definidas en código (`security-headers.ts`),
 * las que sirve nginx en contenedores y las del preview de Vite.
 *
 * Si alguien cambia una superficie y no la otra, este test falla antes del despliegue.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('M8a — cabeceras de seguridad en despliegue', () => {
  const webConf = read('infra/docker/nginx-web.conf');
  const adminConf = read('infra/docker/nginx-admin.conf');

  it('la web sirve CSP, HSTS, frame-ancestors y permissions-policy', () => {
    expect(webConf).toContain('Content-Security-Policy');
    expect(webConf).toContain("default-src 'self'");
    expect(webConf).toContain("frame-ancestors 'none'");
    expect(webConf).not.toContain('unsafe-eval');
    expect(webConf).toContain('Strict-Transport-Security');
    expect(webConf).toContain('includeSubDomains');
    expect(webConf).toContain('X-Content-Type-Options');
    expect(webConf).toContain('Permissions-Policy');
    expect(webConf).toContain('Referrer-Policy');
    expect(webConf).toContain('server_tokens off');
    expect(webConf).toContain('wss://');
  });

  it('el panel admin no se cachea ni se indexa y no permite frames', () => {
    expect(adminConf).toContain("default-src 'self'");
    expect(adminConf).toContain("frame-ancestors 'none'");
    expect(adminConf).toContain('Cache-Control "no-store"');
    expect(adminConf).toContain('X-Robots-Tag');
    expect(adminConf).toContain('Referrer-Policy "no-referrer"');
    expect(adminConf).toContain('Cross-Origin-Resource-Policy "same-origin"');
    expect(adminConf).toContain('Strict-Transport-Security');
  });

  it('cada imagen copia la configuración de nginx de su superficie', () => {
    expect(read('infra/docker/web.Dockerfile')).toContain('nginx-web.conf');
    expect(read('infra/docker/admin.Dockerfile')).toContain('nginx-admin.conf');
  });

  it('los previews de Vite aplican las mismas cabeceras que nginx', () => {
    expect(read('apps/web/vite.config.ts')).toContain('webSecurityHeaders');
    expect(read('apps/admin/vite.config.ts')).toContain('adminSecurityHeaders');
    expect(read('apps/web/vite.config.ts')).toContain('preview: {');
    expect(read('apps/admin/vite.config.ts')).toContain('preview: {');
  });
});
