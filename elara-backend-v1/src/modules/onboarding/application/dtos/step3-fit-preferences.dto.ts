import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  TopFit,
  BottomFit,
  WaistPreference,
  SleeveFit,
  TopLength,
  BottomLength,
} from '../../domain/enums/fit-preferences.enum';

export class Step3FitPreferencesDto {
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(TopFit)
  @IsOptional()
  topFit?: TopFit;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(BottomFit)
  @IsOptional()
  bottomFit?: BottomFit;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(WaistPreference)
  @IsOptional()
  waistPreference?: WaistPreference;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(SleeveFit)
  @IsOptional()
  sleeveFit?: SleeveFit;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(TopLength)
  @IsOptional()
  topLength?: TopLength;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(BottomLength)
  @IsOptional()
  bottomLength?: BottomLength;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @MaxLength(500)
  @IsOptional()
  additionalNotes?: string;
}
