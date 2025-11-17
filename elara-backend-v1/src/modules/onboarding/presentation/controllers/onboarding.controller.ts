import {
  Controller,
  Post,
  Put,
  Delete,
  Get,
  Body,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../../auth/infrastructure/guards/jwt-auth.guard';
import { OnboardingService } from '../../application/services/onboarding.service';
import { Step1GenderGoalDto } from '../../application/dtos/step1-gender-goal.dto';
import { Step2BodyAnalysisDto } from '../../application/dtos/step2-body-analysis.dto';
import { Step3FitPreferencesDto } from '../../application/dtos/step3-fit-preferences.dto';
import { Step4StylePreferencesDto } from '../../application/dtos/step4-style-preferences.dto';
import { Step5BrandPreferencesDto } from '../../application/dtos/step5-brand-preferences.dto';
import { Step6SizingDto } from '../../application/dtos/step6-sizing.dto';
import { Step7LocationDto } from '../../application/dtos/step7-location.dto';
import { Step8SocialMediaDto } from '../../application/dtos/step8-social-media.dto';
import { Step9DataRetentionDto } from '../../application/dtos/step9-data-retention.dto';
import { UpdateProfileDto } from '../../application/dtos/update-profile.dto';

@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  /**
   * POST /onboarding/step1
   * Save gender and goal
   */
  @Post('step1')
  async saveStep1(@Request() req: any, @Body() dto: Step1GenderGoalDto) {
    console.log('Step1 Controller - req.user:', req.user);
    const userId = req.user.userId;
    console.log('Step1 Controller - extracted userId:', userId);
    return this.onboardingService.saveStep1(userId, dto);
  }

  /**
   * POST /onboarding/step2
   * Upload full body image and save analysis
   */
  @Post('step2')
  @UseInterceptors(FileInterceptor('image'))
  async saveStep2(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: Step2BodyAnalysisDto,
  ) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    const userId = req.user.userId;
    return this.onboardingService.saveStep2(userId, file, dto);
  }

  /**
   * POST /onboarding/step3
   * Save fit preferences
   */
  @Post('step3')
  async saveStep3(@Request() req: any, @Body() dto: Step3FitPreferencesDto) {
    const userId = req.user.userId;
    return this.onboardingService.saveStep3(userId, dto);
  }

  /**
   * POST /onboarding/step4
   * Save style preferences
   */
  @Post('step4')
  async saveStep4(@Request() req: any, @Body() dto: Step4StylePreferencesDto) {
    const userId = req.user.userId;
    return this.onboardingService.saveStep4(userId, dto);
  }

  /**
   * POST /onboarding/step5
   * Save brand preferences
   */
  @Post('step5')
  async saveStep5(@Request() req: any, @Body() dto: Step5BrandPreferencesDto) {
    const userId = req.user.userId;
    return this.onboardingService.saveStep5(userId, dto);
  }

  /**
   * POST /onboarding/step6
   * Save sizing
   */
  @Post('step6')
  async saveStep6(@Request() req: any, @Body() dto: Step6SizingDto) {
    const userId = req.user.userId;
    return this.onboardingService.saveStep6(userId, dto);
  }

  /**
   * POST /onboarding/step7
   * Save location
   */
  @Post('step7')
  async saveStep7(@Request() req: any, @Body() dto: Step7LocationDto) {
    console.log('Step7 Controller - Raw body:', req.body);
    console.log('Step7 Controller - Transformed DTO:', dto);
    const userId = req.user.userId;
    console.log('Step7 Controller - userId:', userId);
    return this.onboardingService.saveStep7(userId, dto);
  }

  /**
   * POST /onboarding/step8
   * Save social media
   */
  @Post('step8')
  async saveStep8(@Request() req: any, @Body() dto: Step8SocialMediaDto) {
    const userId = req.user.userId;
    return this.onboardingService.saveStep8(userId, dto);
  }

  /**
   * POST /onboarding/step9
   * Save data retention (GDPR) and complete onboarding
   */
  @Post('step9')
  async saveStep9(@Request() req: any, @Body() dto: Step9DataRetentionDto) {
    const userId = req.user.userId;
    return this.onboardingService.saveStep9(userId, dto);
  }

  /**
   * GET /onboarding/profile
   * Get user profile
   */
  @Get('profile')
  async getProfile(@Request() req: any) {
    const userId = req.user.userId;
    return this.onboardingService.getProfile(userId);
  }

  /**
   * PUT /onboarding/profile
   * Update user profile (general update after onboarding)
   */
  @Put('profile')
  async updateProfile(@Request() req: any, @Body() dto: UpdateProfileDto) {
    const userId = req.user.userId;
    return this.onboardingService.updateProfile(userId, dto);
  }

  /**
   * DELETE /onboarding/profile
   * Delete user profile (GDPR compliance)
   */
  @Delete('profile')
  async deleteProfile(@Request() req: any) {
    const userId = req.user.userId;
    return this.onboardingService.deleteProfile(userId);
  }
}
