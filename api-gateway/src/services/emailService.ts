import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config({ path: '../../../.env' });

export class EmailService {
  private static transporter: nodemailer.Transporter | null = null;

  static async initialize(): Promise<void> {
    try {
      this.transporter = nodemailer.createTransport({
        host: process.env['SMTP_HOST'],
        port: parseInt(process.env['SMTP_PORT'] || '587'),
        secure: false, // true for 465, false for other ports
        auth: {
          user: process.env['SMTP_USER'],
          pass: process.env['SMTP_PASSWORD'],
        },
      });

      // Verify connection configuration
      if (this.transporter) {
        await this.transporter.verify();
        console.log('Email service initialized successfully');
      }
    } catch (error) {
      console.error('Failed to initialize email service:', error);
      throw error;
    }
  }

  static async sendVerificationEmail(email: string, username: string, verificationCode: string): Promise<void> {
    if (!this.transporter) {
      throw new Error('Email service not initialized');
    }

    const mailOptions = {
      from: `"LinkChecker" <${process.env['SMTP_USER']}>`,
      to: email,
      subject: 'Подтверждение регистрации - LinkChecker',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #003f38;">Добро пожаловать в LinkChecker!</h2>
          <p>Привет, ${username}!</p>
          <p>Спасибо за регистрацию в LinkChecker. Для завершения регистрации введите следующий код подтверждения:</p>
          
          <div style="background-color: #fcc406; color: #003f38; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
            <h1 style="margin: 0; font-size: 32px; letter-spacing: 5px;">${verificationCode}</h1>
          </div>
          
          <p>Этот код действителен в течение 15 минут.</p>
          <p>Если вы не регистрировались в LinkChecker, просто проигнорируйте это письмо.</p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="color: #666; font-size: 12px;">
            С уважением,<br>
            Команда LinkChecker
          </p>
        </div>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Verification email sent to ${email}`);
    } catch (error) {
      console.error('Failed to send verification email:', error);
      throw error;
    }
  }

  static async sendPasswordResetEmail(email: string, username: string, resetCode: string): Promise<void> {
    if (!this.transporter) {
      throw new Error('Email service not initialized');
    }

    const mailOptions = {
      from: `"LinkChecker" <${process.env['SMTP_USER']}>`,
      to: email,
      subject: 'Сброс пароля - LinkChecker',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #003f38;">Сброс пароля</h2>
          <p>Привет, ${username}!</p>
          <p>Вы запросили сброс пароля для вашего аккаунта LinkChecker. Введите следующий код для сброса пароля:</p>
          
          <div style="background-color: #fcc406; color: #003f38; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
            <h1 style="margin: 0; font-size: 32px; letter-spacing: 5px;">${resetCode}</h1>
          </div>
          
          <p>Этот код действителен в течение 15 минут.</p>
          <p>Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.</p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="color: #666; font-size: 12px;">
            С уважением,<br>
            Команда LinkChecker
          </p>
        </div>
      `
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Password reset email sent to ${email}`);
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      throw error;
    }
  }
}
