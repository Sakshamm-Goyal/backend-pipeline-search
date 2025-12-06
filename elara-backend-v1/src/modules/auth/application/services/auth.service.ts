import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { USER_REPOSITORY_TOKEN } from '../../../../shared/constants/tokens';
import { UserRepository } from '../../../user/infrastructure/persistence/repositories/user.repository';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { OAuthService } from './oauth.service';
import { EmailService } from '../../../../shared/services/email.service';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { randomBytes } from 'crypto';
import { User } from '../../../user/domain/schemas/user.schema';
import { toStringId } from '../../../../shared/utils/mongoose.utils';

@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY_TOKEN)
    private readonly userRepository: UserRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly oauthService: OAuthService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Register new user
   * SECURITY: Returns same message regardless of whether email exists to prevent enumeration
   */
  async register(dto: RegisterDto): Promise<{ message: string }> {
    const isDevelopment = process.env.NODE_ENV === 'development';

    // Check if user already exists
    const existingUser = await this.userRepository.findByEmail(dto.email);

    // SECURITY FIX: Return same message to prevent user enumeration
    if (existingUser) {
      // Don't reveal that user exists - send notification to existing email (skip in dev if email fails)
      if (!isDevelopment) {
        await this.emailService.sendAccountExistsEmail(dto.email);
      } else {
        try {
          await this.emailService.sendAccountExistsEmail(dto.email);
        } catch (error) {
          // Silently ignore email errors in development
        }
      }
      return {
        message: 'Registration successful. Please check your email to verify your account.',
      };
    }

    // Hash password
    const hashedPassword = await this.passwordService.hashPassword(dto.password);

    // Generate email verification token
    const emailVerificationToken = randomBytes(32).toString('hex');

    // In development mode, auto-verify email
    const emailVerified = isDevelopment;

    // Create user
    await this.userRepository.create({
      email: dto.email,
      password: hashedPassword,
      firstName: dto.firstName,
      lastName: dto.lastName,
      emailVerificationToken: isDevelopment ? undefined : emailVerificationToken,
      emailVerified,
    } as any);

    // Send verification email (skip in development or handle errors gracefully)
    if (!isDevelopment) {
      await this.emailService.sendVerificationEmail(dto.email, emailVerificationToken);
    } else {
      try {
        await this.emailService.sendVerificationEmail(dto.email, emailVerificationToken);
      } catch (error) {
        // Silently ignore email errors in development - user is already verified
      }
    }

    return {
      message: isDevelopment
        ? 'Registration successful. Email auto-verified in development mode.'
        : 'Registration successful. Please check your email to verify your account.',
    };
  }

  /**
   * Login user
   */
  async login(
    dto: LoginDto,
    ipAddress: string,
    userAgent: string,
  ): Promise<AuthResponseDto> {
    const isDevelopment = process.env.NODE_ENV === 'development';

    // Validate user credentials
    const user = await this.validateUser(dto.email, dto.password);

    // Check if email is verified (skip in development mode)
    if (!user.emailVerified && !isDevelopment) {
      throw new UnauthorizedException('Please verify your email before logging in');
    }

    // Generate tokens
    const accessToken = this.tokenService.generateAccessToken(user);
    const refreshToken = await this.tokenService.generateRefreshToken(
      user,
      ipAddress,
      userAgent,
    );

    // Update last login
    await this.userRepository.update((user._id as any).toString(), {
      lastLoginAt: new Date(),
      lastLoginIp: ipAddress,
    } as any);

    return {
      accessToken,
      refreshToken,
      user: {
        id: (user._id as any).toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        emailVerified: user.emailVerified,
      },
    };
  }

  /**
   * Validate user credentials (used by Passport local strategy)
   */
  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.userRepository.findByEmailWithPassword(email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.password) {
      throw new UnauthorizedException('Please use social login (Google/Apple)');
    }

    const isPasswordValid = await this.passwordService.verifyPassword(
      user.password,
      password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if password needs rehashing
    if (this.passwordService.needsRehash(user.password)) {
      const newHash = await this.passwordService.hashPassword(password);
      await this.userRepository.update((user._id as any).toString(), { password: newHash } as any);
    }

    return user;
  }

  /**
   * Refresh access token
   */
  async refreshTokens(
    refreshToken: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // SECURITY FIX: Verify JWT signature first
    let payload;
    try {
      payload = this.tokenService.verifyRefreshToken(refreshToken);
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // SECURITY FIX: Validate token exists in database and is not revoked
    const storedToken = await this.tokenService.validateRefreshToken(refreshToken);
    if (!storedToken) {
      throw new UnauthorizedException('Refresh token not found or revoked');
    }

    // Check if token is expired (belt and suspenders with TTL index)
    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Get user
    const user = await this.userRepository.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Generate new tokens
    const newAccessToken = this.tokenService.generateAccessToken(user);
    const newRefreshToken = await this.tokenService.generateRefreshToken(
      user,
      ipAddress,
      userAgent,
    );

    // Revoke old refresh token (rotation)
    await this.tokenService.revokeRefreshToken(refreshToken, ipAddress, newRefreshToken);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * Verify email
   */
  async verifyEmail(token: string): Promise<{ message: string }> {
    const user = await this.userRepository.findByEmailVerificationToken(token);

    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    if (user.emailVerified) {
      return { message: 'Email already verified' };
    }

    await this.userRepository.update((user._id as any).toString(), {
      emailVerified: true,
      emailVerifiedAt: new Date(),
      emailVerificationToken: undefined,
    } as any);

    return { message: 'Email verified successfully' };
  }

  /**
   * Request password reset
   */
  async forgotPassword(email: string): Promise<{ message: string }> {
    const user = await this.userRepository.findByEmail(email);

    // Always return success to prevent email enumeration
    if (!user) {
      return { message: 'If an account exists, a password reset link has been sent' };
    }

    // Generate reset token
    const resetToken = randomBytes(32).toString('hex');
    const resetExpires = new Date();
    resetExpires.setHours(resetExpires.getHours() + 1); // 1 hour expiration

    await this.userRepository.update((user._id as any).toString(), {
      passwordResetToken: resetToken,
      passwordResetExpires: resetExpires,
    } as any);

    // Send reset email
    await this.emailService.sendPasswordResetEmail(email, resetToken);

    return { message: 'If an account exists, a password reset link has been sent' };
  }

  /**
   * Reset password
   */
  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.userRepository.findByPasswordResetToken(token);

    if (!user || (user.passwordResetExpires && user.passwordResetExpires < new Date())) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Hash new password
    const hashedPassword = await this.passwordService.hashPassword(newPassword);

    // Update password and clear reset token
    await this.userRepository.update((user._id as any).toString(), {
      password: hashedPassword,
      passwordResetToken: undefined,
      passwordResetExpires: undefined,
    } as any);

    // Revoke all refresh tokens for security
    await this.tokenService.revokeAllUserTokens((user._id as any).toString(), 'password-reset');

    return { message: 'Password reset successfully' };
  }

  /**
   * Logout (revoke refresh token)
   */
  async logout(refreshToken: string, ipAddress: string): Promise<{ message: string }> {
    await this.tokenService.revokeRefreshToken(refreshToken, ipAddress);
    return { message: 'Logged out successfully' };
  }

  /**
   * Validate OAuth user (delegated to OAuthService)
   */
  async validateOAuthUser(profile: any): Promise<User> {
    return this.oauthService.validateOAuthUser(profile);
  }
}
