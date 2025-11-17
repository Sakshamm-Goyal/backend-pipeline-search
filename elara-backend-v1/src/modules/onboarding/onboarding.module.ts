import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { UserProfile, UserProfileSchema } from './domain/schemas/user-profile.schema';
import { User, UserSchema } from '../user/domain/schemas/user.schema';
import { UserProfileRepository } from './infrastructure/repositories/user-profile.repository';
import { OnboardingService } from './application/services/onboarding.service';
import { OnboardingController } from './presentation/controllers/onboarding.controller';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [
    ConfigModule,
    SharedModule,
    MongooseModule.forFeature([
      { name: UserProfile.name, schema: UserProfileSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService, UserProfileRepository],
  exports: [OnboardingService, UserProfileRepository],
})
export class OnboardingModule {}
