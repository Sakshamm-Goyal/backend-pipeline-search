import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserProfileRepository } from '../../infrastructure/repositories/user-profile.repository';
import { StorageService } from '../../../shared/services/storage.service';
import { ImageProcessingService } from '../../../shared/services/image-processing.service';
import { User } from '../../../user/domain/schemas/user.schema';
import { Step1GenderGoalDto } from '../dtos/step1-gender-goal.dto';
import { Step2BodyAnalysisDto } from '../dtos/step2-body-analysis.dto';
import { Step3FitPreferencesDto } from '../dtos/step3-fit-preferences.dto';
import { Step4StylePreferencesDto } from '../dtos/step4-style-preferences.dto';
import { Step5BrandPreferencesDto } from '../dtos/step5-brand-preferences.dto';
import { Step6SizingDto } from '../dtos/step6-sizing.dto';
import { Step7LocationDto } from '../dtos/step7-location.dto';
import { Step8SocialMediaDto } from '../dtos/step8-social-media.dto';
import { Step9DataRetentionDto } from '../dtos/step9-data-retention.dto';
import { UpdateProfileDto } from '../dtos/update-profile.dto';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private userProfileRepository: UserProfileRepository,
    private storageService: StorageService,
    private imageProcessingService: ImageProcessingService,
  ) {}

  /**
   * Step 1: Save gender and goal
   */
  async saveStep1(userId: string, dto: Step1GenderGoalDto) {
    try {
      console.log('saveStep1 - received userId:', userId, 'type:', typeof userId);
      const userObjectId = new Types.ObjectId(userId);
      console.log('saveStep1 - converted to ObjectId:', userObjectId);

      // Check if profile already exists
      const existingProfile =
        await this.userProfileRepository.findByUserId(userObjectId);

      if (existingProfile) {
        // Update existing profile
        await this.userProfileRepository.updateByUserId(userObjectId, {
          gender: dto.gender,
          goal: dto.goal,
        });
        this.logger.log(`Step 1 updated for userId: ${userId}`);
      } else {
        // Create new profile with Step 1 data
        await this.userProfileRepository.create({
          userId: userObjectId,
          gender: dto.gender,
          goal: dto.goal,
        });
        this.logger.log(`Step 1 created for userId: ${userId}`);
      }

      // Update user onboarding status
      await this.updateOnboardingStatus(userId, 1);

      return { message: 'Step 1 saved successfully', step: 1 };
    } catch (error) {
      this.logger.error(`Failed to save Step 1: ${error}`);
      throw error;
    }
  }

  /**
   * Step 2: Upload full body image and save analysis
   */
  async saveStep2(
    userId: string,
    file: Express.Multer.File,
    dto?: Step2BodyAnalysisDto,
  ) {
    try {
      const profile = await this.userProfileRepository.findByUserId(userId);
      if (!profile) {
        throw new NotFoundException('User profile not found. Please complete Step 1 first.');
      }

      // Validate image
      const isValid = await this.imageProcessingService.isValidImage(file.buffer);
      if (!isValid) {
        throw new BadRequestException('Invalid image file');
      }

      // Process image (resize, thumbnail)
      const processed = await this.imageProcessingService.processImage(
        file.buffer,
      );

      // Upload to GCS
      const filePath = this.storageService.generateFilePath(
        userId,
        'onboarding/body-images',
        file.originalname,
      );

      const { url, key } = await this.storageService.uploadBuffer(
        processed.resized || processed.original,
        filePath,
        file.mimetype,
      );

      // Prepare final data (user overrides take precedence)
      const finalData = {
        skinUndertone: dto?.skinUndertone || profile.fullBodyAnalysis?.final?.skinUndertone,
        bodyType: dto?.bodyType || profile.fullBodyAnalysis?.final?.bodyType,
        heightCm: dto?.heightCm || profile.fullBodyAnalysis?.final?.heightCm,
      };

      // Prepare full body analysis data (only include defined values)
      const fullBodyAnalysisData: any = {
        imageUrl: url,
        imageKey: key,
        final: finalData,
        uploadedAt: new Date(),
      };

      // Only add userOverrides if dto is provided
      if (dto) {
        fullBodyAnalysisData.userOverrides = dto;
      }

      // TODO: Add AI extraction when implemented
      // if (aiExtracted) {
      //   fullBodyAnalysisData.aiExtracted = aiExtracted;
      // }

      // Update profile with body analysis
      await this.userProfileRepository.updateByUserId(userId, {
        fullBodyAnalysis: fullBodyAnalysisData,
      } as any);

      // Update user onboarding status
      await this.updateOnboardingStatus(userId, 2);

      this.logger.log(`Step 2 saved for userId: ${userId}`);

      return {
        message: 'Step 2 saved successfully',
        step: 2,
        imageUrl: url,
        final: finalData,
      };
    } catch (error) {
      this.logger.error(`Failed to save Step 2: ${error}`);
      throw error;
    }
  }

  /**
   * Step 3: Save fit preferences
   */
  async saveStep3(userId: string, dto: Step3FitPreferencesDto) {
    try {
      const profile = await this.userProfileRepository.findByUserId(userId);
      if (!profile) {
        throw new NotFoundException('User profile not found');
      }

      await this.userProfileRepository.updateByUserId(userId, {
        fitPreferences: dto,
      } as any);

      await this.updateOnboardingStatus(userId, 3);

      this.logger.log(`Step 3 saved for userId: ${userId}`);
      return { message: 'Step 3 saved successfully', step: 3 };
    } catch (error) {
      this.logger.error(`Failed to save Step 3: ${error}`);
      throw error;
    }
  }

  /**
   * Step 4: Save style preferences
   */
  async saveStep4(userId: string, dto: Step4StylePreferencesDto) {
    try {
      const profile = await this.userProfileRepository.findByUserId(userId);
      if (!profile) {
        throw new NotFoundException('User profile not found');
      }

      await this.userProfileRepository.updateByUserId(userId, {
        stylePreferences: {
          ...dto,
          selectedStyles: dto.selectedStyles || [],
          avoidStyles: dto.avoidStyles || [],
          colorPreferences: dto.colorPreferences || [],
          avoidColors: dto.avoidColors || [],
        },
      } as any);

      await this.updateOnboardingStatus(userId, 4);

      this.logger.log(`Step 4 saved for userId: ${userId}`);
      return { message: 'Step 4 saved successfully', step: 4 };
    } catch (error) {
      this.logger.error(`Failed to save Step 4: ${error}`);
      throw error;
    }
  }

  /**
   * Step 5: Save brand preferences
   */
  async saveStep5(userId: string, dto: Step5BrandPreferencesDto) {
    try {
      const profile = await this.userProfileRepository.findByUserId(userId);
      if (!profile) {
        throw new NotFoundException('User profile not found');
      }

      await this.userProfileRepository.updateByUserId(userId, {
        brandPreferences: {
          likedBrands: dto.likedBrands || [],
          customBrands: dto.customBrands || [],
          dislikedBrands: dto.dislikedBrands || [],
          priceRange: dto.priceRange,
        },
      } as any);

      await this.updateOnboardingStatus(userId, 5);

      this.logger.log(`Step 5 saved for userId: ${userId}`);
      return { message: 'Step 5 saved successfully', step: 5 };
    } catch (error) {
      this.logger.error(`Failed to save Step 5: ${error}`);
      throw error;
    }
  }

  /**
   * Step 6: Save sizing
   */
  async saveStep6(userId: string, dto: Step6SizingDto) {
    try {
      const profile = await this.userProfileRepository.findByUserId(userId);
      if (!profile) {
        throw new NotFoundException('User profile not found');
      }

      await this.userProfileRepository.updateByUserId(userId, {
        sizing: dto,
      } as any);

      await this.updateOnboardingStatus(userId, 6);

      this.logger.log(`Step 6 saved for userId: ${userId}`);
      return { message: 'Step 6 saved successfully', step: 6 };
    } catch (error) {
      this.logger.error(`Failed to save Step 6: ${error}`);
      throw error;
    }
  }

  /**
   * Step 7: Save location
   */
  async saveStep7(userId: string, dto: Step7LocationDto) {
    try {
      console.log('saveStep7 - userId:', userId);
      console.log('saveStep7 - dto:', JSON.stringify(dto, null, 2));

      const profile = await this.userProfileRepository.findByUserId(userId);
      if (!profile) {
        throw new NotFoundException('User profile not found');
      }

      const locationData: any = {
        city: dto.city,
        state: dto.state,
        country: dto.country,
        timezone: dto.timezone,
      };

      // Only add coordinates if BOTH longitude and latitude are provided
      if (dto.longitude !== undefined && dto.latitude !== undefined) {
        locationData.coordinates = {
          type: 'Point',
          coordinates: [dto.longitude, dto.latitude],
        };
      }

      console.log('saveStep7 - locationData to save:', JSON.stringify(locationData, null, 2));

      await this.userProfileRepository.updateByUserId(userId, {
        location: locationData,
      } as any);

      await this.updateOnboardingStatus(userId, 7);

      this.logger.log(`Step 7 saved for userId: ${userId}`);
      return { message: 'Step 7 saved successfully', step: 7 };
    } catch (error) {
      console.error('saveStep7 - ERROR:', error);
      this.logger.error(`Failed to save Step 7: ${error}`);
      throw error;
    }
  }

  /**
   * Step 8: Save social media
   */
  async saveStep8(userId: string, dto: Step8SocialMediaDto) {
    try {
      const profile = await this.userProfileRepository.findByUserId(userId);
      if (!profile) {
        throw new NotFoundException('User profile not found');
      }

      await this.userProfileRepository.updateByUserId(userId, {
        socialMedia: dto,
      } as any);

      await this.updateOnboardingStatus(userId, 8);

      this.logger.log(`Step 8 saved for userId: ${userId}`);
      return { message: 'Step 8 saved successfully', step: 8 };
    } catch (error) {
      this.logger.error(`Failed to save Step 8: ${error}`);
      throw error;
    }
  }

  /**
   * Step 9: Save data retention (GDPR) and complete onboarding
   */
  async saveStep9(userId: string, dto: Step9DataRetentionDto) {
    try {
      const profile = await this.userProfileRepository.findByUserId(userId);
      if (!profile) {
        throw new NotFoundException('User profile not found');
      }

      if (!dto.consentGiven) {
        throw new BadRequestException('Consent must be given to complete onboarding');
      }

      await this.userProfileRepository.updateByUserId(userId, {
        dataRetention: {
          consentGiven: dto.consentGiven,
          consentGivenAt: new Date(),
          allowDataSharing: dto.allowDataSharing || false,
          allowAITraining: dto.allowAITraining || false,
          dataExpiryDate: dto.dataExpiryDate ? new Date(dto.dataExpiryDate) : undefined,
        },
      } as any);

      // Mark onboarding as completed
      await this.updateOnboardingStatus(userId, 9, true);

      this.logger.log(`Onboarding completed for userId: ${userId}`);
      return { message: 'Onboarding completed successfully', step: 9, completed: true };
    } catch (error) {
      this.logger.error(`Failed to save Step 9: ${error}`);
      throw error;
    }
  }

  /**
   * Get user profile
   */
  async getProfile(userId: string) {
    try {
      const profile = await this.userProfileRepository.findByUserId(userId);
      if (!profile) {
        throw new NotFoundException('User profile not found');
      }

      return profile;
    } catch (error) {
      this.logger.error(`Failed to get profile: ${error}`);
      throw error;
    }
  }

  /**
   * Delete user profile (GDPR compliance)
   */
  async deleteProfile(userId: string) {
    try {
      const profile = await this.userProfileRepository.findByUserId(userId);
      if (!profile) {
        throw new NotFoundException('User profile not found');
      }

      // Soft delete: Mark profile as deleted but retain data for 30 days
      // TODO: Add scheduled job to permanently delete after 30 days
      const deleted = await this.userProfileRepository.deleteByUserId(userId);

      if (!deleted) {
        throw new BadRequestException('Failed to delete profile');
      }

      this.logger.log(`Profile deleted for userId: ${userId}`);
      return { message: 'Profile deleted successfully. Data will be permanently removed after 30 days.' };
    } catch (error) {
      this.logger.error(`Failed to delete profile: ${error}`);
      throw error;
    }
  }

  /**
   * Update user profile (general update after onboarding)
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    try {
      const profile = await this.userProfileRepository.findByUserId(userId);
      if (!profile) {
        throw new NotFoundException('User profile not found');
      }

      // Build update object from DTO sections
      const updateData: any = {};

      if (dto.genderGoal) {
        if (dto.genderGoal.gender !== undefined) {
          updateData.gender = dto.genderGoal.gender;
        }
        if (dto.genderGoal.goal !== undefined) {
          updateData.goal = dto.genderGoal.goal;
        }
      }

      if (dto.bodyAnalysis) {
        // Update only userOverrides for body analysis
        // Image updates should use separate endpoint
        if (profile.fullBodyAnalysis) {
          updateData.fullBodyAnalysis = {
            ...profile.fullBodyAnalysis,
            userOverrides: {
              ...profile.fullBodyAnalysis.userOverrides,
              ...dto.bodyAnalysis,
            },
            // Recalculate final values
            final: {
              skinUndertone: dto.bodyAnalysis.skinUndertone || profile.fullBodyAnalysis.final?.skinUndertone,
              bodyType: dto.bodyAnalysis.bodyType || profile.fullBodyAnalysis.final?.bodyType,
              heightCm: dto.bodyAnalysis.heightCm || profile.fullBodyAnalysis.final?.heightCm,
            },
          };
        }
      }

      if (dto.fitPreferences) {
        updateData.fitPreferences = {
          ...profile.fitPreferences,
          ...dto.fitPreferences,
        };
      }

      if (dto.stylePreferences) {
        updateData.stylePreferences = {
          ...profile.stylePreferences,
          ...dto.stylePreferences,
        };
      }

      if (dto.brandPreferences) {
        updateData.brandPreferences = {
          ...profile.brandPreferences,
          ...dto.brandPreferences,
        };
      }

      if (dto.sizing) {
        updateData.sizing = {
          ...profile.sizing,
          ...dto.sizing,
        };
      }

      if (dto.location) {
        const locationData: any = {
          ...profile.location,
          ...dto.location,
        };

        // Handle coordinates update
        if (dto.location.longitude !== undefined && dto.location.latitude !== undefined) {
          locationData.coordinates = {
            type: 'Point',
            coordinates: [dto.location.longitude, dto.location.latitude],
          };
        }

        updateData.location = locationData;
      }

      if (dto.socialMedia) {
        updateData.socialMedia = {
          ...profile.socialMedia,
          ...dto.socialMedia,
        };
      }

      const updatedProfile = await this.userProfileRepository.updateByUserId(
        userId,
        updateData,
      );

      this.logger.log(`Profile updated for userId: ${userId}`);
      return updatedProfile;
    } catch (error) {
      this.logger.error(`Failed to update profile: ${error}`);
      throw error;
    }
  }

  /**
   * Update user onboarding status
   */
  private async updateOnboardingStatus(
    userId: string,
    currentStep: number,
    completed: boolean = false,
  ) {
    try {
      console.log('updateOnboardingStatus - received userId:', userId, 'type:', typeof userId);
      // Convert string userId to ObjectId for MongoDB query
      const userObjectId = new Types.ObjectId(userId);
      console.log('updateOnboardingStatus - converted to ObjectId:', userObjectId);
      const user = await this.userModel.findById(userObjectId);
      console.log('updateOnboardingStatus - found user:', user ? 'YES' : 'NO');
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const updateData: any = {
        'onboardingStatus.currentStep': currentStep,
      };

      if (!user.onboardingStatus.startedAt) {
        updateData['onboardingStatus.startedAt'] = new Date();
      }

      if (completed) {
        updateData['onboardingStatus.completed'] = true;
        updateData['onboardingStatus.completedAt'] = new Date();
      }

      await this.userModel.findByIdAndUpdate(userObjectId, updateData);

      this.logger.log(
        `Onboarding status updated for userId: ${userId}, step: ${currentStep}, completed: ${completed}`,
      );
    } catch (error) {
      this.logger.error(`Failed to update onboarding status: ${error}`);
      throw error;
    }
  }
}
