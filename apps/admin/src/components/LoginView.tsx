import { useState, type FormEvent } from 'react';
import type { AdminCredentials } from '../lib/api.js';
import { Button, Field, inputClass } from './primitives.js';

export function LoginView({
  onSubmit,
  error,
  pending,
}: {
  readonly onSubmit: (credentials: AdminCredentials) => void;
  readonly error: string | null;
  readonly pending: boolean;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ email: email.trim(), password, totpCode: totpCode.trim() });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-10 text-ivory">
      <form
        onSubmit={submit}
        aria-labelledby="admin-login-heading"
        className="w-full max-w-sm space-y-4 rounded-2xl border border-sky/30 bg-cloth/40 p-6 shadow-2xl"
      >
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
            Truco Start · Administración
          </p>
          <h1 id="admin-login-heading" className="font-display text-2xl font-bold">
            Ingreso con 2FA
          </h1>
          <p className="text-xs leading-relaxed text-ivory/65">
            El acceso exige contraseña y código TOTP de 6 dígitos. Esta consola usa cookies
            separadas de las de jugador y sesiones cortas.
          </p>
        </div>

        <Field label="Email">
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            placeholder="moderador@truco.ar"
          />
        </Field>

        <Field label="Contraseña">
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Código 2FA (TOTP)" hint="6 dígitos de tu app autenticadora.">
          <input
            inputMode="numeric"
            name="totpCode"
            autoComplete="one-time-code"
            required
            pattern="[0-9]{6}"
            maxLength={6}
            value={totpCode}
            onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))}
            className={`${inputClass} tracking-[0.4em]`}
            placeholder="000000"
          />
        </Field>

        {error && (
          <p
            role="alert"
            className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger-strong"
          >
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Verificando…' : 'Ingresar al panel'}
        </Button>

        <p className="text-[11px] leading-relaxed text-muted">
          Sin contraseñas por defecto: el primer administrador se crea por CLI (
          <code className="text-ivory/70">pnpm --filter @truco/api admin:create</code>).
        </p>
      </form>
    </main>
  );
}
