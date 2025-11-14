import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface EmailOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

/**
 * Email Service using Nodemailer
 * Supports SMTP, Gmail, and testing with Ethereal
 */
@Injectable()
export class EmailService {
  private transporter!: Transporter;
  private readonly logger = new Logger(EmailService.name);
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(private readonly configService: ConfigService) {
    this.fromEmail = this.configService.get<string>('mail.from') || 'noreply@elara.com';
    this.fromName = this.configService.get<string>('mail.fromName') || 'Elara';
    this.initializeTransporter();
  }

  /**
   * Initialize email transporter based on environment configuration
   */
  private async initializeTransporter(): Promise<void> {
    const host = this.configService.get<string>('mail.host');
    const port = this.configService.get<number>('mail.port');
    const secure = this.configService.get<boolean>('mail.secure');
    const user = this.configService.get<string>('mail.auth.user');
    const pass = this.configService.get<string>('mail.auth.pass');

    // If no mail config in production, fail fast
    if (process.env.NODE_ENV === 'production' && (!host || !user || !pass)) {
      throw new Error('SECURITY ERROR: Email configuration required in production');
    }

    // Use Ethereal for development/testing if no config provided
    if (!host || !user) {
      this.logger.warn('No email configuration found, using Ethereal test account');
      const testAccount = await nodemailer.createTestAccount();
      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      this.logger.log(`Ethereal test account created: ${testAccount.user}`);
      return;
    }

    // Production/configured transporter
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });

    this.logger.log(`Email transporter initialized: ${host}:${port}`);
  }

  /**
   * Send email
   */
  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      const info = await this.transporter.sendMail({
        from: `${this.fromName} <${this.fromEmail}>`,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      this.logger.log(`Email sent to ${options.to}: ${info.messageId}`);

      // Preview URL for Ethereal (development only)
      if (process.env.NODE_ENV !== 'production') {
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) {
          this.logger.log(`Preview URL: ${previewUrl}`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to send email to ${options.to}:`, error);
      throw new Error('Failed to send email');
    }
  }

  /**
   * Send verification email
   */
  async sendVerificationEmail(email: string, token: string): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';
    const verificationUrl = `${frontendUrl}/auth/verify-email?token=${token}`;

    await this.sendEmail({
      to: email,
      subject: 'Verify Your Email - Elara',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Verify Your Email</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #4a5568;">Welcome to Elara!</h1>
            <p>Thank you for registering. Please verify your email address by clicking the button below:</p>
            <div style="margin: 30px 0;">
              <a href="${verificationUrl}"
                 style="background-color: #4299e1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                Verify Email Address
              </a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #4299e1;">${verificationUrl}</p>
            <p style="margin-top: 30px; color: #718096; font-size: 14px;">
              If you didn't create an account, you can safely ignore this email.
            </p>
          </div>
        </body>
        </html>
      `,
      text: `Welcome to Elara! Please verify your email by visiting: ${verificationUrl}`,
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3001';
    const resetUrl = `${frontendUrl}/auth/reset-password?token=${token}`;

    await this.sendEmail({
      to: email,
      subject: 'Reset Your Password - Elara',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Reset Your Password</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #4a5568;">Password Reset Request</h1>
            <p>We received a request to reset your password. Click the button below to create a new password:</p>
            <div style="margin: 30px 0;">
              <a href="${resetUrl}"
                 style="background-color: #4299e1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
                Reset Password
              </a>
            </div>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #4299e1;">${resetUrl}</p>
            <p style="margin-top: 30px; color: #718096; font-size: 14px;">
              This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
            </p>
          </div>
        </body>
        </html>
      `,
      text: `Password reset requested. Visit this link to reset your password: ${resetUrl}`,
    });
  }

  /**
   * Send account already exists notification (for security)
   */
  async sendAccountExistsEmail(email: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Registration Attempt - Elara',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Registration Attempt</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #4a5568;">Account Already Exists</h1>
            <p>Someone attempted to create an account with this email address, but an account already exists.</p>
            <p>If this was you, you can log in using your existing credentials.</p>
            <p style="margin-top: 30px; color: #718096; font-size: 14px;">
              If you didn't attempt to register, your account is secure and no action is needed.
            </p>
          </div>
        </body>
        </html>
      `,
      text: `Someone attempted to create an account with this email, but an account already exists. If this was you, please log in with your existing credentials.`,
    });
  }
}
