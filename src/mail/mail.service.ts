import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false, // STARTTLS
      auth: {
        user: 'bc1efb001@smtp-brevo.com',
        pass: this.configService.get<string>('BREVO_SMTP_PASS'),
      },
    });
  }

  async sendVerificationEmail(
    toEmail: string,
    name: string,
    token: string,
  ): Promise<void> {
    const appUrl = this.configService.get<string>('CLIENT_URL');
    const verifyUrl = `${appUrl}/verify-email?token=${token}`;

    await this.transporter.sendMail({
      from: `"Image App" <bc1efb001@smtp-brevo.com>`,
      to: toEmail,
      subject: 'Verify your email address',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #1a1a1a;">Welcome${name ? `, ${name}` : ''}!</h2>
          <p style="color: #444; line-height: 1.6;">
            Thanks for signing up. Please verify your email address to activate your account.
          </p>
          <a href="${verifyUrl}"
             style="display: inline-block; margin: 24px 0; padding: 12px 28px;
                    background: #4f46e5; color: #fff; text-decoration: none;
                    border-radius: 6px; font-weight: 600;">
            Verify Email
          </a>
          <p style="color: #888; font-size: 13px;">
            This link expires in 24 hours. If you didn't create an account, you can ignore this email.
          </p>
          <p style="color: #bbb; font-size: 12px;">
            Or copy this link: <br />
            <span style="word-break: break-all;">${verifyUrl}</span>
          </p>
        </div>
      `,
    });

    this.logger.log(`Verification email sent to ${toEmail}`);
  }
}
