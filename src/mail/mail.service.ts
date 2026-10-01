import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private configService: ConfigService) {}

  async sendVerificationEmail(
    toEmail: string,
    name: string,
    token: string,
  ): Promise<void> {
    const apiKey = this.configService.get<string>('BREVO_API_KEY');
    const appUrl = this.configService.get<string>('CLIENT_URL');
    const verifyUrl = `${appUrl}/verify-email?token=${token}`;

    this.logger.log(`Sending verification email to ${toEmail}`);
    this.logger.log(`Verify URL: ${verifyUrl}`);
    this.logger.log(`API key set: ${!!apiKey}`);

    const payload = {
      sender: { name: 'Image App', email: 'bc1efb001@smtp-brevo.com' },
      to: [{ email: toEmail, name: name || toEmail }],
      subject: 'Verify your email address',
      htmlContent: `
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
            Or copy this link:<br />
            <span style="word-break: break-all;">${verifyUrl}</span>
          </p>
        </div>
      `,
    };

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey as string,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`Brevo API error ${response.status}: ${errorBody}`);
      throw new InternalServerErrorException(
        'Failed to send verification email',
      );
    }

    const result = (await response.json()) as { messageId?: string };
    this.logger.log(`Email sent — messageId: ${result.messageId}`);
  }
}
