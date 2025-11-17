import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Occasion } from '../../../wardrobe/domain/enums/occasion.enum';
import { Season } from '../../../wardrobe/domain/enums/season.enum';

export class QueryOutfitDto {
  @IsBoolean()
  @IsOptional()
  isFavorite?: boolean;

  @IsEnum(Occasion)
  @IsOptional()
  occasion?: Occasion;

  @IsEnum(Season)
  @IsOptional()
  season?: Season;
}
