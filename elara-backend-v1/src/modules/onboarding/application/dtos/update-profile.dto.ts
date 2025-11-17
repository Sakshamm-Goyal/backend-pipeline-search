import { IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Step1GenderGoalDto } from './step1-gender-goal.dto';
import { Step2BodyAnalysisDto } from './step2-body-analysis.dto';
import { Step3FitPreferencesDto } from './step3-fit-preferences.dto';
import { Step4StylePreferencesDto } from './step4-style-preferences.dto';
import { Step5BrandPreferencesDto } from './step5-brand-preferences.dto';
import { Step6SizingDto } from './step6-sizing.dto';
import { Step7LocationDto } from './step7-location.dto';
import { Step8SocialMediaDto } from './step8-social-media.dto';

/**
 * DTO for general profile updates after onboarding completion
 * Allows updating any profile section without re-submitting entire steps
 */
export class UpdateProfileDto {
  // Step 1: Gender & Goal
  @IsOptional()
  @ValidateNested()
  @Type(() => Step1GenderGoalDto)
  genderGoal?: Partial<Step1GenderGoalDto>;

  // Step 2: Body Analysis (Note: Image update should use separate endpoint)
  @IsOptional()
  @ValidateNested()
  @Type(() => Step2BodyAnalysisDto)
  bodyAnalysis?: Partial<Step2BodyAnalysisDto>;

  // Step 3: Fit Preferences
  @IsOptional()
  @ValidateNested()
  @Type(() => Step3FitPreferencesDto)
  fitPreferences?: Partial<Step3FitPreferencesDto>;

  // Step 4: Style Preferences
  @IsOptional()
  @ValidateNested()
  @Type(() => Step4StylePreferencesDto)
  stylePreferences?: Partial<Step4StylePreferencesDto>;

  // Step 5: Brand Preferences
  @IsOptional()
  @ValidateNested()
  @Type(() => Step5BrandPreferencesDto)
  brandPreferences?: Partial<Step5BrandPreferencesDto>;

  // Step 6: Sizing
  @IsOptional()
  @ValidateNested()
  @Type(() => Step6SizingDto)
  sizing?: Partial<Step6SizingDto>;

  // Step 7: Location
  @IsOptional()
  @ValidateNested()
  @Type(() => Step7LocationDto)
  location?: Partial<Step7LocationDto>;

  // Step 8: Social Media
  @IsOptional()
  @ValidateNested()
  @Type(() => Step8SocialMediaDto)
  socialMedia?: Partial<Step8SocialMediaDto>;
}
