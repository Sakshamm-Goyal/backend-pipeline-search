import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RefreshToken } from '../../../domain/schemas/refresh-token.schema';

@Injectable()
export class RefreshTokenRepository {
  constructor(
    @InjectModel(RefreshToken.name)
    private readonly refreshTokenModel: Model<RefreshToken>,
  ) {}

  async create(tokenData: Partial<RefreshToken>): Promise<RefreshToken> {
    const token = new this.refreshTokenModel(tokenData);
    return token.save();
  }

  async findByToken(token: string): Promise<RefreshToken | null> {
    return this.refreshTokenModel.findOne({ token, isRevoked: false }).exec();
  }

  async revokeToken(token: string, ipAddress: string, replacedByToken?: string): Promise<void> {
    await this.refreshTokenModel
      .updateOne(
        { token },
        {
          isRevoked: true,
          revokedAt: new Date(),
          revokedByIp: ipAddress,
          replacedByToken,
        },
      )
      .exec();
  }

  async revokeAllUserTokens(userId: string | Types.ObjectId, ipAddress: string): Promise<void> {
    await this.refreshTokenModel
      .updateMany(
        { userId, isRevoked: false },
        {
          isRevoked: true,
          revokedAt: new Date(),
          revokedByIp: ipAddress,
        },
      )
      .exec();
  }

  async deleteExpiredTokens(): Promise<void> {
    await this.refreshTokenModel
      .deleteMany({
        expiresAt: { $lt: new Date() },
      })
      .exec();
  }
}
