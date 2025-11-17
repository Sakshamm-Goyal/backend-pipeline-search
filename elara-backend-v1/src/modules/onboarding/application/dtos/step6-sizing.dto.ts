import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { SizingRegion } from '../../domain/enums/sizing-region.enum';

class MeasurementsDto {
  @Transform(({ value }) => (value === '' || value === null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  @IsOptional()
  bust?: number; // in cm

  @Transform(({ value }) => (value === '' || value === null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  @IsOptional()
  waist?: number;

  @Transform(({ value }) => (value === '' || value === null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  @IsOptional()
  hips?: number;

  @Transform(({ value }) => (value === '' || value === null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  @IsOptional()
  inseam?: number;

  @Transform(({ value }) => (value === '' || value === null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  @IsOptional()
  shoulder?: number;

  @Transform(({ value }) => (value === '' || value === null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  @IsOptional()
  sleeveLength?: number;
}

export class Step6SizingDto {
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(SizingRegion)
  region!: SizingRegion;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @IsOptional()
  tops?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @IsOptional()
  bottoms?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @IsOptional()
  dresses?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @IsOptional()
  shoes?: string;

  @ValidateNested()
  @Type(() => MeasurementsDto)
  @IsOptional()
  measurements?: MeasurementsDto;

  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return undefined;
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  @IsOptional()
  preferNumericSizing?: boolean;
}
