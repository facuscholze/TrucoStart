#!/usr/bin/env node
/**
 * Verificación automática de la regla 13: «Sin dinero real ni ventaja pagada».
 *
 * Se prohíben apuestas, depósitos, retiros, premios monetarios, compra de monedas
 * con dinero y transferencias entre jugadores. M9c permite únicamente `VIRTUAL_COIN`
 * sin valor económico, sin compras ni transferencias y canjeable por cosméticos;
 * sus flags y el libro mayor inmutable se protegen además en PostgreSQL/tests.
 *
 * Este script busca MECANISMOS de dinero real: pasarelas de pago, campos de saldo
 * monetario mutable, endpoints de depósito/retiro y copy que prometa dinero. No
 * confunde el libro mayor simbólico de M9c con dinero real. Las palabras del truco
 * («Real Envido», «apuesta» como canto, «gana la baza») se excluyen explícitamente.
 *
 * Se escanean archivos trackeados y archivos nuevos no ignorados del working tree,
 * sin requerir `git add`; así una revisión local ve los mismos cambios que CI.
 *
 * Uso: node scripts/check-no-real-money.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Extensiones que pueden contener un mecanismo de pago. */
const SOURCE_EXTENSIONS = /\.(ts|tsx|mjs|cjs|js|jsx|sql|json)$/;

/**
 * El chequeo de COPY (promesas de dinero) sólo tiene sentido donde hay copy de
 * interfaz: la web, el panel y los componentes. En scripts, tests y docs las
 * palabras «dinero real» aparecen para NEGARLO o para describir la regla, y
 * marcarlas sería ruido que termina en una allowlist frágil.
 */
const COPY_ROOTS = ['apps/web/src/', 'apps/admin/src/', 'packages/ui/src/'];

/**
 * Archivos que nombran dinero para NEGARLO o para DETECTARLO, no para integrarlo.
 * La allowlist se mantiene mínima y explícita; cualquier alta nueva debe
 * justificarse acá, no relajando una regla.
 */
const MECHANISM_ALLOWLIST = [
  // Se autoexcluye: contiene los patrones y los mensajes de error.
  'scripts/check-no-real-money.mjs',
  // Escáneres que nombran Stripe/Resend para DETECTAR claves filtradas.
  'scripts/scan-secrets.mjs',
  'scripts/test-scan-secrets.mjs',
  'scripts/check-bundles-no-secrets.mjs',
  // Smoke test: su mensaje de falla dice "no existen endpoints de dinero real".
  'scripts/smoke-staging.mjs',
  // Textos legales y copy del pie: afirman que NO hay dinero real (M8d).
  'apps/web/src/features/legal/legal-content.ts',
  'apps/web/src/components/AppShell.tsx',
  'apps/web/src/i18n/messages-screens.es-AR.ts',
  // Test que ASEVERA la ausencia de dinero real en los términos.
  'apps/web/tests/m8d-legal.spec.tsx',
];

/** Un pago real siempre necesita una pasarela: si aparece una, es un hallazgo. */
const PAYMENT_PROVIDER =
  /\b(mercadopago|mercado_pago|stripe|paypal|culqi|payu|checkout\.com|webpay|braintree|adyen|debin|transferencia_bancaria|cbu|cvu|alias_bancario)\b/i;

/** Campos mutables que representarían un saldo de valor real; el ledger simbólico M9c no coincide con estos nombres. */
const BALANCE_MECHANISM =
  /\b(wallet_?balance|coin_?balance|token_?balance|credit_?balance|account_?balance|wallet_?id|ledger_?entry|ledger_?account|deposit_?amount|withdraw_?amount|payout_?amount)\b/i;

/** Endpoint o acción que mueva dinero. */
const MONEY_ENDPOINT =
  /@(Post|Patch|Put)\(\s*['"][^'"]*\b(deposit|deposito|depósitos|withdraw|retiro|retiros|payout|topup|top-up|cobro|cobrar|pagar|purchase|comprar)\b/i;

/** Copy que prometa dinero, premios en efectivo o ganancias. */
const MONEY_PROMISE =
  /\b(gan[aá] (dinero|plata|efectivo)|dinero real|plata real|premios? en (dinero|efectivo)|retir[aá] (tu|tus) (dinero|ganancias|saldo)|cobr[aá] tus ganancias|apost[aá] (dinero|plata)|deposit[aá] dinero)\b/i;

function listFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => SOURCE_EXTENSIONS.test(file))
    .filter((file) => !file.startsWith('node_modules/') && !file.startsWith('dist/'));
}

const findings = [];

function report(rule, file, line, excerpt) {
  findings.push({ rule, file, line, excerpt: excerpt.trim().slice(0, 120) });
}

for (const file of listFiles()) {
  let content;
  try {
    content = readFileSync(path.join(ROOT, file), 'utf8');
  } catch {
    continue;
  }
  const lines = content.split('\n');
  const isAllowlisted = MECHANISM_ALLOWLIST.includes(file);
  const hasUiCopy = COPY_ROOTS.some((root) => file.startsWith(root));

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;

    if (isAllowlisted) continue;

    if (PAYMENT_PROVIDER.test(line)) report('pasarela-de-pago', file, lineNumber, line);
    if (BALANCE_MECHANISM.test(line)) report('saldo-o-billetera', file, lineNumber, line);
    if (MONEY_ENDPOINT.test(line)) report('endpoint-de-dinero', file, lineNumber, line);
    // El copy sólo se evalúa donde hay interfaz real.
    if (hasUiCopy && MONEY_PROMISE.test(line))
      report('copy-con-promesa-de-dinero', file, lineNumber, line);
  }
}

if (findings.length === 0) {
  const checked = listFiles().length;
  console.log(
    `Regla 13 OK: sin pasarelas de pago, saldos monetarios mutables, endpoints ni promesas de dinero (${checked} archivos revisados).`,
  );
} else {
  console.error('Regla 13 VIOLADA — se encontraron mecanismos de dinero real:');
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line} [${finding.rule}] ${finding.excerpt}`);
  }
  console.error(
    '\nLa regla 13 del proyecto prohíbe apuestas, depósitos, retiros, premios en dinero y transferencias entre jugadores.',
  );
  process.exitCode = 1;
}
