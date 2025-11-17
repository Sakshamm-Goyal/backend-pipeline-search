import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsMongoId,
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
  wardrobeItemId!: string;

  @IsEnum(WardrobeCategory)
  category!: WardrobeCategory;

  @IsString()
  @IsOptional()
  subcategory?: string;
}

export class UpdateOutfitDto {
  @IsString()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OutfitItemDto)
  @IsOptional()
  items?: OutfitItemDto[];

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
