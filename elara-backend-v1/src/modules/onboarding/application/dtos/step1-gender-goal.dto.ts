import { IsEnum, IsNotEmpty } from 'class-validator';
import { Gender } from '../../domain/enums/gender.enum';
import { OnboardingGoal } from '../../domain/enums/onboarding-goal.enum';

export class Step1GenderGoalDto {
  @IsEnum(Gender)
  @IsNotEmpty()
  gender!: Gender;

  @IsEnum(OnboardingGoal)
  @IsNotEmpty()
  goal!: OnboardingGoal;
}
