#!/usr/bin/env node
/**
 * Verificación automática de la regla 13: «Producto sin dinero real».
 *
 * La regla 13 prohíbe implementar apuestas, depósitos, retiros, premios en dinero
 * o transferencias de monedas entre jugadores. Hasta M8d eso se revisaba a mano y
 * una revisión manual no protege contra la próxima persona que abra un PR.
 *
 * Este script busca MECANISMOS, no palabras: pasarelas de pago, columnas de saldo
 * o billetera, endpoints de depósito/retiro y copy que prometa dinero. Las
 * palabras del truco («Real Envido», «apuesta» como canto, «gana la baza») se
 * excluyen explícitamente, porque son vocabulario del juego y no un mecanismo.
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
 * Archivos donde las palabras de dinero aparecen a propósito, porque declaran que
 * NO hay dinero real. Se excluyen sólo del chequeo de copy, nunca del de código.
 */
const COPY_DISCLOSURE_ALLOWLIST = [
  // Tests que ASEVERAN la ausencia de dinero real: hablan del tema para negarlo.
  'apps/web/tests/m8d-legal.spec.tsx',
  // Los escáneres de secretos nombran a Stripe/Resend para DETECTAR claves
  // filtradas: no son una integración de pagos.
  'scripts/scan-secrets.mjs',
  'scripts/test-scan-secrets.mjs',
  'scripts/check-bundles-no-secrets.mjs',
  'apps/web/src/features/legal/legal-content.ts',
  'apps/web/src/features/legal/LegalScreen.tsx',
  'apps/web/src/components/AppShell.tsx',
  'apps/web/src/i18n/messages-screens.es-AR.ts',
  'docs/',
  'README.md',
];

/** Un pago real siempre necesita una pasarela: si aparece una, es un hallazgo. */
const PAYMENT_PROVIDER =
  /\b(mercadopago|mercado_pago|stripe|paypal|culqi|payu|checkout\.com|webpay|braintree|adyen|debin|transferencia_bancaria|cbu|cvu|alias_bancario)\b/i;

/** Columnas o campos que representarían saldo, billetera o libro contable. */
const BALANCE_MECHANISM =
  /\b(wallet_?balance|coin_?balance|token_?balance|credit_?balance|account_?balance|wallet_?id|ledger_?entry|ledger_?account|deposit_?amount|withdraw_?amount|payout_?amount)\b/i;

/** Endpoint o acción que mueva dinero. */
const MONEY_ENDPOINT =
  /@(Post|Patch|Put)\(\s*['"][^'"]*\b(deposit|deposito|depósitos|withdraw|retiro|retiros|payout|topup|top-up|cobro|cobrar|pagar|purchase|comprar)\b/i;

/** Copy que prometa dinero, premios en efectivo o ganancias. */
const MONEY_PROMISE =
  /\b(gan[aá] (dinero|plata|efectivo)|dinero real|plata real|premios? en (dinero|efectivo)|retir[aá] (tu|tus) (dinero|ganancias|saldo)|cobr[aá] tus ganancias|apost[aá] (dinero|plata)|deposit[aá] dinero)\b/i;

function listFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });
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
  const isAllowlisted = COPY_DISCLOSURE_ALLOWLIST.some(
    (allowed) => file === allowed || file.startsWith(allowed),
  );

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;

    // La allowlist cubre las tres familias: son archivos que nombran dinero para
    // NEGARLO (texto legal, copy del pie) o para DETECTAR claves filtradas.
    if (isAllowlisted) continue;

    if (PAYMENT_PROVIDER.test(line)) report('pasarela-de-pago', file, lineNumber, line);
    if (BALANCE_MECHANISM.test(line)) report('saldo-o-billetera', file, lineNumber, line);
    if (MONEY_ENDPOINT.test(line)) report('endpoint-de-dinero', file, lineNumber, line);
    if (MONEY_PROMISE.test(line)) report('copy-con-promesa-de-dinero', file, lineNumber, line);
  }
}

if (findings.length === 0) {
  const checked = listFiles().length;
  console.log(
    `Regla 13 OK: sin pasarelas de pago, saldos, endpoints de dinero ni promesas de dinero (${checked} archivos revisados).`,
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
