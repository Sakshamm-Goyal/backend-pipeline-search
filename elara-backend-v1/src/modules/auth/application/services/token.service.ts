import { Injectable, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ConfigType } from '@nestjs/config';
import jwtConfig from '../../../../config/jwt.config';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { RefreshTokenRepository } from '../../infrastructure/persistence/repositories/refresh-token.repository';
import { REFRESH_TOKEN_REPOSITORY_TOKEN } from '../../../../shared/constants/tokens';
import { User } from '../../../user/domain/schemas/user.schema';
import { Types } from 'mongoose';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(jwtConfig.KEY)
    private readonly jwtConfiguration: ConfigType<typeof jwtConfig>,
    @Inject(REFRESH_TOKEN_REPOSITORY_TOKEN)
    private readonly refreshTokenRepository: RefreshTokenRepository,
  ) {}

  /**
   * Generate access token (short-lived, 15 minutes)
   */
  generateAccessToken(user: User): string {
    const payload: any = {
      sub: (user._id as any).toString(),
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
    };

    return this.jwtService.sign(payload, {
      secret: this.jwtConfiguration.accessSecret,
      expiresIn: this.jwtConfiguration.accessExpiration,
    } as any);
  }

  /**
   * Generate refresh token (long-lived, 7 days)
   */
  async generateRefreshToken(
    user: User,
    ipAddress: string,
    userAgent: string,
  ): Promise<string> {
    const payload: any = {
      sub: (user._id as any).toString(),
      email: user.email,
      role: user.role,
    };

    const token = this.jwtService.sign(payload, {
      secret: this.jwtConfiguration.refreshSecret,
      expiresIn: this.jwtConfiguration.refreshExpiration,
    } as any);

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    // Save to database
    await this.refreshTokenRepository.create({
      token,
      userId: new Types.ObjectId((user._id as any).toString()),
      expiresAt,
      createdByIp: ipAddress,
      userAgent,
    } as any);

    return token;
  }

  /**
   * Verify and decode access token
   */
  verifyAccessToken(token: string): JwtPayload {
    return this.jwtService.verify(token, {
      secret: this.jwtConfiguration.accessSecret,
    });
  }

  /**
   * Verify and decode refresh token (JWT signature only)
   */
  verifyRefreshToken(token: string): JwtPayload {
    return this.jwtService.verify(token, {
      secret: this.jwtConfiguration.refreshSecret,
    });
  }

  /**
   * Validate refresh token against database (checks if revoked)
   * SECURITY: Always call this after verifyRefreshToken to ensure token hasn't been revoked
   */
  async validateRefreshToken(token: string) {
    return this.refreshTokenRepository.findByToken(token);
  }

  /**
   * Revoke refresh token (on logout or token rotation)
   */
  async revokeRefreshToken(
    token: string,
    ipAddress: string,
    replacedByToken?: string,
  ): Promise<void> {
    await this.refreshTokenRepository.revokeToken(token, ipAddress, replacedByToken);
  }

  /**
   * Revoke all user's refresh tokens (on password change, security breach)
   */
  async revokeAllUserTokens(userId: string, ipAddress: string): Promise<void> {
    await this.refreshTokenRepository.revokeAllUserTokens(userId, ipAddress);
  }

  /**
   * Clean expired tokens (run as cron job)
   */
  async cleanExpiredTokens(): Promise<void> {
    await this.refreshTokenRepository.deleteExpiredTokens();
  }
}
