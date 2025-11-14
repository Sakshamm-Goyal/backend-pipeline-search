import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../../domain/schemas/user.schema';
import { AuthProvider } from '../../../../auth/domain/enums/auth-provider.enum';

@Injectable()
export class UserRepository {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
  ) {}

  async create(userData: Partial<User>): Promise<User> {
    const user = new this.userModel(userData);
    return user.save();
  }

  async findById(id: string): Promise<User | null> {
    return this.userModel.findById(id).exec();
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userModel.findOne({ email }).exec();
  }

  async findByEmailWithPassword(email: string): Promise<User | null> {
    return this.userModel.findOne({ email }).select('+password').exec();
  }

  async findByEmailVerificationToken(token: string): Promise<User | null> {
    return this.userModel.findOne({ emailVerificationToken: token }).select('+emailVerificationToken').exec();
  }

  async findByPasswordResetToken(token: string): Promise<User | null> {
    return this.userModel
      .findOne({
        passwordResetToken: token,
        passwordResetExpires: { $gt: new Date() },
      })
      .select('+passwordResetToken')
      .exec();
  }

  async findByOAuthProvider(provider: AuthProvider, providerId: string): Promise<User | null> {
    return this.userModel
      .findOne({
        'providers.provider': provider,
        'providers.providerId': providerId,
      })
      .exec();
  }

  async update(id: string, updateData: Partial<User>): Promise<User | null> {
    return this.userModel.findByIdAndUpdate(id, updateData, { new: true }).exec();
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.userModel.findByIdAndDelete(id).exec();
    return !!result;
  }
}
