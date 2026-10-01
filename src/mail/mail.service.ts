import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    const pass = this.configService.get<string>('BREVO_SMTP_PASS');
    this.logger.log(
      `SMTP init — user: bc1efb001@smtp-brevo.com, pass set: ${!!pass}`,
    );

    this.transporter = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      secure: false, // STARTTLS
      auth: {
        user: 'bc1efb001@smtp-brevo.com',
        pass,
      },
    });
  }

  async sendVerificationEmail(
    toEmail: string,
    name: string,
    token: string,
  ): Promise<void> {
    const appUrl = this.configService.get<string>('APP_URL'); // fixed: was CLIENT_URL
    const verifyUrl = `${appUrl}/verify-email?token=${token}`;

    this.logger.log(
      `Sending verification email to ${toEmail}, url: ${verifyUrl}`,
    );

    try {
      const info = await this.transporter.sendMail({
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

      this.logger.log(`Email sent — messageId: ${info.messageId}`);
    } catch (err) {
      this.logger.error(`Failed to send email to ${toEmail}`, err);
      throw new InternalServerErrorException(
        'Failed to send verification email',
      );
    }
  }
}
