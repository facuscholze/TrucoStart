import { DomainApiException } from '../../../common/api-exception.js';
import type { EmailProvider, OutboundEmailMessage } from './email.provider.js';

/**
 * Adaptador productivo para Resend (https://resend.com). Activado cuando
 * `EMAIL_PROVIDER=resend` y `RESEND_API_KEY` está configurado.
 *
 * Usa el fetch nativo de Node 22; no incorpora dependencias adicionales.
 * Las plantillas son HTML mínimo con enlace en texto plano para evitar
 * problemas de entregabilidad (los clicks los maneja la app web).
 */
export class ResendEmailProvider implements EmailProvider {
  readonly providerName = 'resend';
  readonly isSimulated = false;

  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
    private readonly webBaseUrl: string,
    private readonly outbox?: OutboundEmailMessage[],
  ) {}

  async sendVerificationEmail(params: {
    readonly to: string;
    readonly nickname: string;
    readonly token: string;
    readonly expiresAt: Date;
  }): Promise<void> {
    const verifyUrl = `${this.webBaseUrl}/verify-email?token=${encodeURIComponent(params.token)}`;
    await this._send({
      to: params.to,
      subject: 'Confirmá tu correo en Mesa de Truco',
      html: `
        <p>Hola ${escapeHtml(params.nickname)},</p>
        <p>Usá este enlace para verificar tu correo:</p>
        <p><a href="${escapeAttr(verifyUrl)}">${escapeHtml(verifyUrl)}</a></p>
        <p>El enlace expira el ${params.expiresAt.toISOString()}.</p>
      `,
      text: `Hola ${params.nickname},\n\nConfirmá tu correo abriendo este enlace:\n${verifyUrl}\n\nExpira: ${params.expiresAt.toISOString()}\n`,
      template: 'EMAIL_VERIFICATION',
      nickname: params.nickname,
      token: params.token,
      expiresAt: params.expiresAt,
    });
  }

  async sendPasswordResetEmail(params: {
    readonly to: string;
    readonly nickname: string;
    readonly token: string;
    readonly expiresAt: Date;
  }): Promise<void> {
    const resetUrl = `${this.webBaseUrl}/reset-password?token=${encodeURIComponent(params.token)}`;
    await this._send({
      to: params.to,
      subject: 'Restablecé tu contraseña en Mesa de Truco',
      html: `
        <p>Hola ${escapeHtml(params.nickname)},</p>
        <p>Pediste restablecer tu contraseña. Abrí este enlace:</p>
        <p><a href="${escapeAttr(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
        <p>El enlace expira el ${params.expiresAt.toISOString()}. Si no fuiste vos, ignoralo.</p>
      `,
      text: `Hola ${params.nickname},\n\nRestablecé tu contraseña abriendo:\n${resetUrl}\n\nExpira: ${params.expiresAt.toISOString()}\n`,
      template: 'PASSWORD_RESET',
      nickname: params.nickname,
      token: params.token,
      expiresAt: params.expiresAt,
    });
  }

  private async _send(msg: {
    readonly to: string;
    readonly subject: string;
    readonly html: string;
    readonly text: string;
    readonly template: OutboundEmailMessage['template'];
    readonly nickname: string;
    readonly token: string;
    readonly expiresAt: Date;
  }): Promise<void> {
    const body = {
      from: this.fromAddress,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    };
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new DomainApiException(
        502,
        'BAD_GATEWAY',
        `No se pudo enviar el correo (${res.status}): ${detail.slice(0, 200)}`,
      );
    }
    const sentAt = new Date();
    this.outbox?.push({
      to: msg.to,
      template: msg.template,
      nickname: msg.nickname,
      token: msg.token,
      expiresAt: msg.expiresAt,
      sentAt,
    });
  }
}

/**
 * Adaptador SMTP genérico usando nodemailer (opcional). Activado cuando
 * `EMAIL_PROVIDER=smtp` y `SMTP_CONNECTION_URL` está configurado.
 *
 * NOTA: requiere `nodemailer` como dependencia opcional. Si el paquete no
 * está instalado, se lanza un error de configuración al iniciar.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly providerName = 'smtp';
  readonly isSimulated = false;

  constructor(
    private readonly transport: {
      sendMail: (opts: {
        from: string;
        to: string;
        subject: string;
        html: string;
        text: string;
      }) => Promise<unknown>;
    },
    private readonly fromAddress: string,
    private readonly webBaseUrl: string,
    private readonly outbox?: OutboundEmailMessage[],
  ) {}

  static async create(options: {
    connectionUrl: string;
    fromAddress: string;
    webBaseUrl: string;
    outbox?: OutboundEmailMessage[];
  }): Promise<SmtpEmailProvider> {
    // nodemailer es una dependencia opcional (no se requiere en sandbox).
    type NodemailerLike = {
      createTransport: (url: string) => {
        verify: () => Promise<unknown>;
        sendMail: (opts: unknown) => Promise<unknown>;
      };
    };
    let nodemailer: NodemailerLike;
    try {
      // nodemailer es una dependencia opcional: en sandbox no está instalada
      // y no se requieren tipos. En staging/prod se instala por separado si
      // EMAIL_PROVIDER=smtp.
      // @ts-expect-error: optional dep, types not required in monorepo, types not required in monorepo
      nodemailer = (await import('nodemailer')) as unknown as NodemailerLike;
    } catch {
      throw new DomainApiException(
        500,
        'BAD_GATEWAY',
        'EMAIL_PROVIDER=smtp pero el paquete `nodemailer` no está instalado',
      );
    }
    const transport = nodemailer.createTransport(options.connectionUrl);
    await transport.verify().catch((err: unknown) => {
      throw new DomainApiException(
        500,
        'BAD_GATEWAY',
        `No se pudo conectar al servidor SMTP: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return new SmtpEmailProvider(
      transport,
      options.fromAddress,
      options.webBaseUrl,
      options.outbox,
    );
  }

  async sendVerificationEmail(params: {
    to: string;
    nickname: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    const verifyUrl = `${this.webBaseUrl}/verify-email?token=${encodeURIComponent(params.token)}`;
    await this.transport.sendMail({
      from: this.fromAddress,
      to: params.to,
      subject: 'Confirmá tu correo en Mesa de Truco',
      html: `<p>Hola ${escapeHtml(params.nickname)}</p><p><a href="${escapeAttr(verifyUrl)}">${escapeHtml(verifyUrl)}</a></p>`,
      text: `Hola ${params.nickname}\n\n${verifyUrl}`,
    });
    this.outbox?.push({
      ...params,
      template: 'EMAIL_VERIFICATION',
      sentAt: new Date(),
    });
  }

  async sendPasswordResetEmail(params: {
    to: string;
    nickname: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    const resetUrl = `${this.webBaseUrl}/reset-password?token=${encodeURIComponent(params.token)}`;
    await this.transport.sendMail({
      from: this.fromAddress,
      to: params.to,
      subject: 'Restablecé tu contraseña en Mesa de Truco',
      html: `<p>Hola ${escapeHtml(params.nickname)}</p><p><a href="${escapeAttr(resetUrl)}">${escapeHtml(resetUrl)}</a></p>`,
      text: `Hola ${params.nickname}\n\n${resetUrl}`,
    });
    this.outbox?.push({
      ...params,
      template: 'PASSWORD_RESET',
      sentAt: new Date(),
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]!,
  );
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
