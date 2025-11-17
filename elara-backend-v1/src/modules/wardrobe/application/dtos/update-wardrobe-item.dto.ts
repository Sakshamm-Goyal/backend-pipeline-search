import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { WardrobeCategory } from '../../domain/enums/wardrobe-category.enum';
import { Currency } from '../../../shared/domain/enums/currency.enum';

export class UpdateWardrobeItemDto {
  @IsEnum(WardrobeCategory)
  @IsOptional()
  category?: WardrobeCategory;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  subcategory?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  userTags?: string[];

  @IsString()
  @MaxLength(100)
  @IsOptional()
  brand?: string;

  @IsDateString()
  @IsOptional()
  purchaseDate?: string;

  @Transform(({ value }) => (value === '' || value === null || value === undefined ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number;

  @IsEnum(Currency)
  @IsOptional()
  currency?: Currency;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isFavorite?: boolean;
}
