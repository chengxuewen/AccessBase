import { createTransport, type Transporter } from 'nodemailer';
import { logger } from '@accessbase/logging';

export interface SmtpConfig {
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  from?: string;
}

export class Mailer {
  private readonly transport: Transporter;
  private readonly from: string;

  private constructor(transport: Transporter, from: string) {
    this.transport = transport;
    this.from = from;
  }

  /** Returns null when host is absent — callers degrade to logging. */
  static fromConfig(cfg: SmtpConfig): Mailer | null {
    if (!cfg.host) return null;
    return new Mailer(
      createTransport({
        host: cfg.host,
        port: cfg.port ?? 587,
        secure: (cfg.port ?? 587) === 465,
        auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? '' } : undefined,
      }),
      cfg.from ?? `no-reply@${cfg.host}`,
    );
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject, html });
    logger.info({ to, subject }, 'Email sent');
  }
}
