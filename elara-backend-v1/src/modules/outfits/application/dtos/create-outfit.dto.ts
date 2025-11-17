import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WardrobeCategory } from '../../../wardrobe/domain/enums/wardrobe-category.enum';
import { Occasion } from '../../../wardrobe/domain/enums/occasion.enum';
import { Season } from '../../../wardrobe/domain/enums/season.enum';

class OutfitItemDto {
  @IsMongoId()
  @IsNotEmpty()
  wardrobeItemId!: string;

  @IsEnum(WardrobeCategory)
  @IsNotEmpty()
  category!: WardrobeCategory;

  @IsString()
  @IsOptional()
  subcategory?: string;
}

export class CreateOutfitDto {
  @IsString()
  @MaxLength(100)
  @IsNotEmpty()
  name!: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OutfitItemDto)
  @IsNotEmpty()
  items!: OutfitItemDto[];

  @IsArray()
  @IsEnum(Occasion, { each: true })
  @IsOptional()
  occasion?: Occasion[];

  @IsArray()
  @IsEnum(Season, { each: true })
  @IsOptional()
  season?: Season[];

  @IsString()
  @MaxLength(500)
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isFavorite?: boolean;
}
