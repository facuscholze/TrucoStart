import {
  type AuthUserSummary,
  LEGAL_DOCUMENT_VERSIONS,
  LEGAL_MIN_AGE_DEFAULT,
} from '@truco/shared';
import { Badge, CallButton, Toast } from '@truco/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import {
  createGuestSessionRequest,
  forgotPasswordRequest,
  loginAccountRequest,
  logoutSessionRequest,
  promoteGuestAccountRequest,
  registerAccountRequest,
  resendVerificationEmailRequest,
  resetPasswordRequest,
  verifyEmailRequest,
} from '../../lib/api-client.js';

export type AuthTab = 'login' | 'register' | 'promote' | 'recover';

export interface AuthScreenProps {
  currentUser: AuthUserSummary | null;
  initialTab?: AuthTab;
  initialResetToken?: string | null;
  initialVerifyToken?: string | null;
  /** Edad mínima vigente para el alta, informada por la API. */
  legalMinAge?: number;
  onSessionChanged: (user: AuthUserSummary | null) => void;
  onNavigate: (path: string) => void;
}

export function AuthScreen({
  currentUser,
  initialTab,
  initialResetToken = null,
  initialVerifyToken = null,
  legalMinAge = LEGAL_MIN_AGE_DEFAULT,
  onSessionChanged,
  onNavigate,
}: AuthScreenProps) {
  const defaultTab: AuthTab =
    initialTab ?? (initialResetToken ? 'recover' : currentUser?.isGuest ? 'promote' : 'login');

  const [tab, setTab] = useState<AuthTab>(defaultTab);
  const [recoverHasToken, setRecoverHasToken] = useState<boolean>(Boolean(initialResetToken));

  const [email, setEmail] = useState<string>(currentUser?.email ?? '');
  const [password, setPassword] = useState<string>('');
  const [nickname, setNickname] = useState<string>(
    currentUser?.isGuest ? currentUser.nickname : '',
  );
  const [resetToken, setResetToken] = useState<string>(initialResetToken ?? '');
  const [verifyToken, setVerifyToken] = useState<string>(initialVerifyToken ?? '');

  /**
   * Aceptación legal. `legalAccepted` es el consentimiento explícito (regla 11:
   * nada se acepta por omisión) y `legalAge` la edad declarada para el control de
   * edad mínima. La edad NO se envía como dato de perfil: sólo viaja en el alta
   * para que el servidor pueda rechazarla si no alcanza el mínimo.
   */
  const [legalAccepted, setLegalAccepted] = useState<boolean>(false);
  const [legalAge, setLegalAge] = useState<string>('');
  const [legalError, setLegalError] = useState<string | null>(null);

  const [busy, setBusy] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!initialVerifyToken) return;
    let active = true;
    setBusy(true);
    void verifyEmailRequest({ token: initialVerifyToken })
      .then(() => {
        if (active) setInfoMsg(messagesEsAr.auth.successEmailVerified);
      })
      .catch((err: unknown) => {
        if (active) {
          setErrorMsg(
            err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback,
          );
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [initialVerifyToken]);

  const handleEnterAsGuest = async () => {
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await createGuestSessionRequest();
      onSessionChanged(res.user);
      onNavigate('/lobby');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await loginAccountRequest({ email, password });
      onSessionChanged(res.user);
      onNavigate('/lobby');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterOrPromote = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setLegalError(null);

    // Doble control antes de llamar a la API: consentimiento explícito y edad
    // declarada. El servidor lo vuelve a validar (nunca se confía en el cliente).
    if (!legalAccepted) {
      setLegalError(messagesEsAr.auth.legalAcceptanceRequired);
      return;
    }
    const declaredAge = Number.parseInt(legalAge, 10);
    if (!Number.isFinite(declaredAge) || declaredAge < legalMinAge) {
      setLegalError(messagesEsAr.auth.legalAgeBelowMinimum(legalMinAge));
      return;
    }

    setBusy(true);
    try {
      const legal = {
        accepted: true as const,
        versions: {
          terminos: LEGAL_DOCUMENT_VERSIONS.terminos,
          privacidad: LEGAL_DOCUMENT_VERSIONS.privacidad,
        },
        age: declaredAge,
      };
      const res =
        tab === 'promote' && currentUser?.isGuest
          ? await promoteGuestAccountRequest({
              email,
              password,
              ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
              legal,
            })
          : await registerAccountRequest({
              email,
              password,
              nickname: nickname.trim(),
              legal,
            });
      onSessionChanged(res.user);
      onNavigate('/perfil');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setBusy(false);
    }
  };

  const handleRecovery = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      if (recoverHasToken) {
        await resetPasswordRequest({
          token: resetToken.trim(),
          newPassword: password,
        });
        setInfoMsg(messagesEsAr.auth.successPasswordReset);
        setPassword('');
        setTab('login');
      } else {
        await forgotPasswordRequest({ email });
        setInfoMsg(messagesEsAr.auth.successRecoveryRequested);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setBusy(false);
    }
  };

  const handleManualVerifyEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!verifyToken.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await verifyEmailRequest({ token: verifyToken.trim() });
      setInfoMsg(messagesEsAr.auth.successEmailVerified);
      setVerifyToken('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const ack = await resendVerificationEmailRequest({ email: email.trim() });
      setInfoMsg(ack.message);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setBusy(false);
    }
  };

  const handleLogoutHere = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      await logoutSessionRequest(false);
      onSessionChanged(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : messagesEsAr.launcher.sessionErrorFallback);
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ id: AuthTab; label: string }> = [
    { id: 'login', label: messagesEsAr.auth.tabLogin },
    currentUser?.isGuest
      ? { id: 'promote', label: messagesEsAr.auth.tabPromote }
      : { id: 'register', label: messagesEsAr.auth.tabRegister },
    { id: 'recover', label: messagesEsAr.auth.tabRecover },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <header className="space-y-1.5">
        <h1 className="font-display text-2xl tablet:text-3xl font-bold text-ivory">
          {messagesEsAr.auth.pageTitle}
        </h1>
        <p className="text-sm text-muted">{messagesEsAr.auth.pageSubtitle}</p>
      </header>

      {errorMsg && <Toast message={errorMsg} tone="danger" onDismiss={() => setErrorMsg(null)} />}
      {infoMsg && <Toast message={infoMsg} tone="success" onDismiss={() => setInfoMsg(null)} />}

      {/* Estado de cuenta registrada activa */}
      {currentUser && !currentUser.isGuest && (
        <section className="rounded-2xl bg-surface border border-gold/35 p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <Badge variant="success">{messagesEsAr.auth.alreadyLoggedTitle}</Badge>
            <div className="font-display text-lg font-bold text-ivory">{currentUser.nickname}</div>
            {currentUser.email && <div className="text-xs text-muted">{currentUser.email}</div>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <CallButton tone="truco" onClick={() => onNavigate('/perfil')}>
              {messagesEsAr.auth.goToProfileCta}
            </CallButton>
            <CallButton tone="decline" disabled={busy} onClick={() => void handleLogoutHere()}>
              {messagesEsAr.auth.logoutHereCta}
            </CallButton>
          </div>
        </section>
      )}

      {/* Acceso rápido como invitado */}
      {!currentUser && (
        <section className="rounded-2xl bg-surface border border-gold/40 p-5 flex items-center justify-between gap-4 flex-wrap shadow-lg">
          <div className="space-y-1 max-w-lg">
            <h2 className="font-display text-lg font-bold text-gold">
              {messagesEsAr.auth.guestCardTitle}
            </h2>
            <p className="text-xs tablet:text-sm text-muted leading-relaxed">
              {messagesEsAr.auth.guestCardBody}
            </p>
          </div>
          <CallButton tone="accept" disabled={busy} onClick={() => void handleEnterAsGuest()}>
            {busy ? messagesEsAr.auth.busySubmitting : messagesEsAr.auth.guestCta}
          </CallButton>
        </section>
      )}

      {/* Formulario por pestañas: Login / Registro o Promoción / Recuperación */}
      <section className="rounded-2xl bg-surface border border-ivory/20 p-5 tablet:p-6 space-y-5 shadow-xl">
        <div
          role="tablist"
          aria-label={messagesEsAr.auth.pageTitle}
          className="flex gap-2 flex-wrap"
        >
          {tabs.map((item) => {
            const selected = tab === item.id;
            return (
              <button
                key={item.id}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => {
                  setTab(item.id);
                  setErrorMsg(null);
                }}
                className={`min-h-[44px] px-4 rounded-xl text-sm font-bold transition-colors ${
                  selected
                    ? 'bg-elevated text-gold border border-gold/55'
                    : 'bg-elevated/40 text-muted hover:text-ivory border border-ivory/15'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {tab === 'login' && (
          <form onSubmit={(e) => void handleLogin(e)} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="auth-login-email" className="block text-xs font-bold text-ivory">
                {messagesEsAr.auth.emailLabel}
              </label>
              <input
                id="auth-login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={messagesEsAr.auth.emailPlaceholder}
                className="w-full min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3.5 text-sm text-ivory placeholder:text-muted/60"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="auth-login-password" className="block text-xs font-bold text-ivory">
                {messagesEsAr.auth.passwordLabel}
              </label>
              <input
                id="auth-login-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={messagesEsAr.auth.passwordPlaceholder}
                className="w-full min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3.5 text-sm text-ivory placeholder:text-muted/60"
              />
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
              <button
                type="button"
                onClick={() => setTab('recover')}
                className="min-h-[44px] px-2 text-xs font-semibold text-sky underline underline-offset-4"
              >
                {messagesEsAr.auth.tabRecover}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] px-5 rounded-xl bg-gold text-surface font-bold text-sm disabled:opacity-50"
              >
                {busy ? messagesEsAr.auth.busySubmitting : messagesEsAr.auth.loginSubmitCta}
              </button>
            </div>
          </form>
        )}

        {/*
          `noValidate` a propósito: la aceptación y la edad se validan en el
          handler para poder mostrar un mensaje propio. Con la validación nativa
          del navegador el submit se cancelaba antes de llegar al handler y la
          persona no veía qué le faltaba.
        */}
        {(tab === 'register' || tab === 'promote') && (
          <form onSubmit={(e) => void handleRegisterOrPromote(e)} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="auth-reg-nickname" className="block text-xs font-bold text-ivory">
                {messagesEsAr.auth.nicknameLabel}
              </label>
              <input
                id="auth-reg-nickname"
                type="text"
                required={tab === 'register'}
                minLength={3}
                maxLength={24}
                autoComplete="nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={messagesEsAr.auth.nicknamePlaceholder}
                className="w-full min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3.5 text-sm text-ivory placeholder:text-muted/60"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="auth-reg-email" className="block text-xs font-bold text-ivory">
                {messagesEsAr.auth.emailLabel}
              </label>
              <input
                id="auth-reg-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={messagesEsAr.auth.emailPlaceholder}
                className="w-full min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3.5 text-sm text-ivory placeholder:text-muted/60"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="auth-reg-password" className="block text-xs font-bold text-ivory">
                {messagesEsAr.auth.passwordLabel}
              </label>
              <input
                id="auth-reg-password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={messagesEsAr.auth.passwordPlaceholder}
                className="w-full min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3.5 text-sm text-ivory placeholder:text-muted/60"
              />
            </div>

            <fieldset className="space-y-3 rounded-xl border border-ivory/20 bg-elevated/60 p-3.5">
              <legend className="px-1 text-xs font-bold text-ivory">
                {messagesEsAr.auth.legalHeading}
              </legend>

              <p className="text-[11px] leading-relaxed text-ivory/80">
                {messagesEsAr.auth.legalMinAgeNotice(legalMinAge)}
              </p>

              <div className="flex items-center gap-2">
                <label htmlFor="auth-reg-age" className="text-xs font-semibold text-ivory">
                  {messagesEsAr.auth.legalAgeLabel}
                </label>
                <input
                  id="auth-reg-age"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={130}
                  value={legalAge}
                  onChange={(e) => setLegalAge(e.target.value)}
                  aria-describedby="auth-reg-age-hint"
                  className="w-20 min-h-[44px] rounded-xl bg-surface border border-ivory/25 px-3 text-sm text-ivory"
                />
                <span id="auth-reg-age-hint" className="text-xs text-ivory/70">
                  {messagesEsAr.auth.legalAgeSuffix}
                </span>
              </div>

              <div className="flex items-start gap-2.5">
                <input
                  id="auth-reg-legal"
                  type="checkbox"
                  checked={legalAccepted}
                  onChange={(e) => {
                    setLegalAccepted(e.target.checked);
                    if (e.target.checked) setLegalError(null);
                  }}
                  aria-describedby="auth-reg-legal-links"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
                />
                <label
                  htmlFor="auth-reg-legal"
                  className="text-[11px] leading-relaxed text-ivory/85"
                >
                  {messagesEsAr.auth.legalAcceptanceLabel}
                </label>
              </div>

              <div id="auth-reg-legal-links" className="flex flex-wrap gap-x-3 gap-y-1">
                <button
                  type="button"
                  onClick={() => onNavigate('/legal/terminos')}
                  className="min-h-[32px] text-[11px] font-semibold text-gold underline underline-offset-2"
                >
                  {messagesEsAr.auth.legalReadTermsCta}
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('/legal/privacidad')}
                  className="min-h-[32px] text-[11px] font-semibold text-gold underline underline-offset-2"
                >
                  {messagesEsAr.auth.legalReadPrivacyCta}
                </button>
              </div>

              {legalError && (
                <p role="alert" className="text-[11px] font-semibold text-danger">
                  {legalError}
                </p>
              )}
            </fieldset>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={busy}
                className="min-h-[44px] px-5 rounded-xl bg-gold text-surface font-bold text-sm disabled:opacity-50"
              >
                {busy
                  ? messagesEsAr.auth.busySubmitting
                  : tab === 'promote'
                    ? messagesEsAr.auth.promoteSubmitCta
                    : messagesEsAr.auth.registerSubmitCta}
              </button>
            </div>
          </form>
        )}

        {tab === 'recover' && (
          <div className="space-y-5">
            <form onSubmit={(e) => void handleRecovery(e)} className="space-y-4">
              {!recoverHasToken ? (
                <div className="space-y-1.5">
                  <label htmlFor="auth-rec-email" className="block text-xs font-bold text-ivory">
                    {messagesEsAr.auth.emailLabel}
                  </label>
                  <input
                    id="auth-rec-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={messagesEsAr.auth.emailPlaceholder}
                    className="w-full min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3.5 text-sm text-ivory placeholder:text-muted/60"
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label htmlFor="auth-rec-token" className="block text-xs font-bold text-ivory">
                      {messagesEsAr.auth.resetTokenLabel}
                    </label>
                    <input
                      id="auth-rec-token"
                      type="text"
                      required
                      minLength={20}
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      placeholder={messagesEsAr.auth.resetTokenPlaceholder}
                      className="w-full min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3.5 text-sm font-mono text-ivory placeholder:text-muted/60"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="auth-rec-newpw" className="block text-xs font-bold text-ivory">
                      {messagesEsAr.auth.newPasswordLabel}
                    </label>
                    <input
                      id="auth-rec-newpw"
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={messagesEsAr.auth.passwordPlaceholder}
                      className="w-full min-h-[44px] rounded-xl bg-elevated border border-ivory/25 px-3.5 text-sm text-ivory placeholder:text-muted/60"
                    />
                  </div>
                </>
              )}

              <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
                <button
                  type="button"
                  onClick={() => setRecoverHasToken((v) => !v)}
                  className="min-h-[44px] px-2 text-xs font-semibold text-sky underline underline-offset-4"
                >
                  {recoverHasToken
                    ? messagesEsAr.auth.switchToForgotModeCta
                    : messagesEsAr.auth.switchToResetModeCta}
                </button>
                <div className="flex items-center gap-2 flex-wrap">
                  {!recoverHasToken && email.trim().length > 4 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleResendVerification()}
                      className="min-h-[44px] px-3.5 rounded-xl bg-elevated border border-ivory/25 text-xs font-semibold text-ivory"
                    >
                      {messagesEsAr.auth.resendVerificationCta}
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={busy}
                    className="min-h-[44px] px-5 rounded-xl bg-gold text-surface font-bold text-sm disabled:opacity-50"
                  >
                    {busy
                      ? messagesEsAr.auth.busySubmitting
                      : recoverHasToken
                        ? messagesEsAr.auth.resetSubmitCta
                        : messagesEsAr.auth.forgotSubmitCta}
                  </button>
                </div>
              </div>
            </form>

            <form
              onSubmit={(e) => void handleManualVerifyEmail(e)}
              className="pt-4 border-t border-ivory/15 flex items-end gap-2 flex-wrap"
            >
              <div className="flex-1 min-w-[200px] space-y-1">
                <label htmlFor="auth-verify-token" className="block text-xs font-bold text-muted">
                  {messagesEsAr.auth.verifyTokenLabel}
                </label>
                <input
                  id="auth-verify-token"
                  type="text"
                  minLength={20}
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  placeholder={messagesEsAr.auth.resetTokenPlaceholder}
                  className="w-full min-h-[44px] rounded-xl bg-elevated border border-ivory/20 px-3 text-xs font-mono text-ivory"
                />
              </div>
              <button
                type="submit"
                disabled={busy || verifyToken.trim().length < 20}
                className="min-h-[44px] px-4 rounded-xl bg-elevated border border-gold/40 text-xs font-bold text-gold disabled:opacity-50"
              >
                {messagesEsAr.auth.verifyEmailSubmitCta}
              </button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
