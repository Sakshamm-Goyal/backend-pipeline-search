import { IsArray, IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { WardrobeCategory } from '../../domain/enums/wardrobe-category.enum';

export class QueryWardrobeDto {
  @IsEnum(WardrobeCategory)
  @IsOptional()
  category?: WardrobeCategory;

  @IsBoolean()
  @IsOptional()
  isFavorite?: boolean;

  @IsString()
  @IsOptional()
  brand?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}
