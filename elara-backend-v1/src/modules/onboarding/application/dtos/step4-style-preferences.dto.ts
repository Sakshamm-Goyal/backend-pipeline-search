import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { StyleTag } from '../../domain/enums/style-tag.enum';

export class Step4StylePreferencesDto {
  @IsArray()
  @IsEnum(StyleTag, { each: true })
  selectedStyles!: StyleTag[];

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(StyleTag)
  @IsOptional()
  primaryStyle?: StyleTag;

  @IsArray()
  @IsEnum(StyleTag, { each: true })
  @IsOptional()
  avoidStyles?: StyleTag[];

  @IsArray()
  @IsString({ each: true })
  @Matches(/^#[0-9A-Fa-f]{6}$/, { each: true })
  @IsOptional()
  colorPreferences?: string[]; // Hex color codes

  @IsArray()
  @IsString({ each: true })
  @Matches(/^#[0-9A-Fa-f]{6}$/, { each: true })
  @IsOptional()
  avoidColors?: string[];

  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return undefined;
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  @IsOptional()
  modestDressing?: boolean;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @MaxLength(200)
  @IsOptional()
  religiousRestrictions?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @MaxLength(200)
  @IsOptional()
  otherRestrictions?: string;
}
