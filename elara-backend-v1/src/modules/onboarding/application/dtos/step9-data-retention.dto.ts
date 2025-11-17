import { IsBoolean, IsDateString, IsNotEmpty, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class Step9DataRetentionDto {
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  @IsNotEmpty()
  consentGiven!: boolean;

  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return undefined;
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  @IsOptional()
  allowDataSharing?: boolean;

  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return undefined;
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  @IsOptional()
  allowAITraining?: boolean;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsDateString()
  @IsOptional()
  dataExpiryDate?: string; // ISO date string
}
