import { Injectable } from '@nestjs/common';

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface OutboundEmailMessage {
  readonly to: string;
  readonly template: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
  readonly nickname: string;
  readonly token: string;
  readonly expiresAt: Date;
  readonly sentAt: Date;
}

export interface EmailProvider {
  readonly providerName: string;
  readonly isSimulated: boolean;
  sendVerificationEmail(params: {
    readonly to: string;
    readonly nickname: string;
    readonly token: string;
    readonly expiresAt: Date;
  }): Promise<void>;
  sendPasswordResetEmail(params: {
    readonly to: string;
    readonly nickname: string;
    readonly token: string;
    readonly expiresAt: Date;
  }): Promise<void>;
}

// STATE-10 cerrado: ResendEmailProvider / SmtpEmailProvider (resend-email.provider.ts)
// se activan con EMAIL_PROVIDER=resend o EMAIL_PROVIDER=smtp cuando las credenciales
// (RESEND_API_KEY o SMTP_CONNECTION_URL) están configuradas; ConsoleEmailProvider sigue
// siendo el default en desarrollo.
@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  readonly providerName = 'console-simulated';
  readonly isSimulated = true;
  private readonly outbox: OutboundEmailMessage[] = [];
  private readonly logToStdout: boolean;

  constructor(options: { logToStdout?: boolean } = {}) {
    this.logToStdout = options.logToStdout ?? false;
  }

  async sendVerificationEmail(params: {
    readonly to: string;
    readonly nickname: string;
    readonly token: string;
    readonly expiresAt: Date;
  }): Promise<void> {
    const entry: OutboundEmailMessage = {
      ...params,
      template: 'EMAIL_VERIFICATION',
      sentAt: new Date(),
    };
    this.outbox.push(entry);
    if (this.logToStdout) {
      process.stdout.write(
        `[ConsoleEmailProvider][SIMULADO] EMAIL_VERIFICATION -> ${params.to} (exp=${params.expiresAt.toISOString()})\n`,
      );
    }
  }

  async sendPasswordResetEmail(params: {
    readonly to: string;
    readonly nickname: string;
    readonly token: string;
    readonly expiresAt: Date;
  }): Promise<void> {
    const entry: OutboundEmailMessage = {
      ...params,
      template: 'PASSWORD_RESET',
      sentAt: new Date(),
    };
    this.outbox.push(entry);
    if (this.logToStdout) {
      process.stdout.write(
        `[ConsoleEmailProvider][SIMULADO] PASSWORD_RESET -> ${params.to} (exp=${params.expiresAt.toISOString()})\n`,
      );
    }
  }

  getSentMessages(): readonly OutboundEmailMessage[] {
    return [...this.outbox];
  }

  getLatestMessageFor(
    email: string,
    template: OutboundEmailMessage['template'],
  ): OutboundEmailMessage | undefined {
    const normalized = email.trim().toLowerCase();
    for (let i = this.outbox.length - 1; i >= 0; i--) {
      const item = this.outbox[i]!;
      if (item.to === normalized && item.template === template) {
        return item;
      }
    }
    return undefined;
  }

  clearOutbox(): void {
    this.outbox.length = 0;
  }
}
