import { CallButton, Modal } from '@truco/ui';
import { messagesEsAr } from '../i18n/messages.es-AR.js';

export interface OnboardingModalProps {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onEnterAsGuest: () => void;
  onGoToLogin: () => void;
}

export function OnboardingModal({
  open,
  busy = false,
  onClose,
  onEnterAsGuest,
  onGoToLogin,
}: OnboardingModalProps) {
  return (
    <Modal
      open={open}
      title={messagesEsAr.onboarding.dialogTitle}
      onClose={onClose}
      closeLabel={messagesEsAr.onboarding.dismissCta}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted leading-relaxed">{messagesEsAr.onboarding.subtitle}</p>

        <ol className="space-y-2.5">
          {messagesEsAr.onboarding.steps.map((step) => (
            <li
              key={step.title}
              className="rounded-xl bg-elevated/90 border border-ivory/15 p-3 space-y-1"
            >
              <h3 className="text-sm font-bold text-gold">{step.title}</h3>
              <p className="text-xs text-ivory/90 leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
          <CallButton tone="neutral" disabled={busy} onClick={onGoToLogin}>
            {messagesEsAr.onboarding.goToLoginCta}
          </CallButton>
          <CallButton tone="accept" disabled={busy} onClick={onEnterAsGuest}>
            {messagesEsAr.onboarding.enterAsGuestCta}
          </CallButton>
        </div>
      </div>
    </Modal>
  );
}
