import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Resend } from 'resend';

export interface ShareEmailOptions {
  to: string[];
  code: string;
  link: string;
  fileCount: number;
  totalSize: string;
  expiresAt: Date;
  burn: boolean;
  message?: string;
}

@Injectable()
export class MailService {
  private resend: Resend | null = null;
  private from: string;

  constructor() {
    // Never hardcode the key — it comes from RESEND_API_KEY env only.
    const apiKey = process.env.RESEND_API_KEY;
    this.from = process.env.EMAIL_FROM || 'Docshare <onboarding@resend.dev>';
    if (apiKey) this.resend = new Resend(apiKey);
  }

  isConfigured(): boolean {
    return this.resend !== null;
  }

  async sendShareEmail(opts: ShareEmailOptions): Promise<{ id?: string; sent: number }> {
    if (!this.resend) {
      throw new HttpException(
        'Email is not configured on this server.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const expiry = opts.expiresAt.toLocaleString();
    const subject = `Someone shared ${opts.fileCount} file${opts.fileCount > 1 ? 's' : ''} with you (Docshare)`;
    const lines = [
      `Someone shared ${opts.fileCount} file${opts.fileCount > 1 ? 's' : ''} (${opts.totalSize}) with you via Docshare.`,
      '',
      `Open this link to download: ${opts.link}`,
      `Or enter code ${opts.code} on the Docshare homepage.`,
      '',
      `Expires: ${expiry}.`,
    ];
    if (opts.burn) {
      lines.push('This share self-destructs after the first download — open it once.');
    }
    if (opts.message) {
      lines.push('', `Note from the sender: ${opts.message}`);
    }
    lines.push('', 'If you were not expecting this, you can safely ignore it.');
    const text = lines.join('\n');

    // Keep HTML minimal and link-only: image-free, single-CTA mail
    // reads as legitimate to spam filters and renders everywhere.
    const html = [
      `<div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:14px;line-height:1.6;max-width:520px">`,
      `<p>Someone shared <strong>${opts.fileCount} file${opts.fileCount > 1 ? 's' : ''}</strong> (${opts.totalSize}) with you via Docshare.</p>`,
      `<p><a href="${opts.link}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 22px;border-radius:6px">Download files</a></p>`,
      `<p style="color:#555">Or enter code <strong>${opts.code}</strong> on the Docshare homepage.<br>Expires: ${expiry}.</p>`,
      opts.burn
        ? `<p style="color:#555">This share self-destructs after the first download — open it once.</p>`
        : '',
      opts.message
        ? `<p style="border-left:2px solid #ccc;padding-left:10px;color:#333">${escapeHtml(opts.message)}</p>`
        : '',
      `<p style="color:#999;font-size:12px">If you were not expecting this, you can safely ignore it.</p>`,
      `</div>`,
    ].join('');

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to: opts.to,
        subject,
        text,
        html,
      });
      if (error) {
        throw new HttpException(
          `Email provider refused the send: ${error.message}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      return { id: data?.id, sent: opts.to.length };
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new HttpException(
        'Email send failed. Try again in a minute.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
