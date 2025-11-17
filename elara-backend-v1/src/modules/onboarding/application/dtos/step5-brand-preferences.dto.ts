import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { Currency } from '../../../shared/domain/enums/currency.enum';

class PriceRangeDto {
  @Transform(({ value }) => (value === '' || value === null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  @IsOptional()
  min?: number;

  @Transform(({ value }) => (value === '' || value === null ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  @IsOptional()
  max?: number;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(Currency)
  @IsOptional()
  currency?: Currency;
}

export class Step5BrandPreferencesDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  likedBrands?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  customBrands?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  dislikedBrands?: string[];

  @ValidateNested()
  @Type(() => PriceRangeDto)
  @IsOptional()
  priceRange?: PriceRangeDto;
}
