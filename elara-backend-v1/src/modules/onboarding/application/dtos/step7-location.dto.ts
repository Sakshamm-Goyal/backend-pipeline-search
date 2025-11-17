import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  Min,
  Max,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

class CoordinatesDto {
  @IsArray()
  @IsNumber({}, { each: true })
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  coordinates!: [number, number]; // [longitude, latitude]
}

export class Step7LocationDto {
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @IsOptional()
  city?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @IsOptional()
  state?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @IsOptional()
  country?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  @IsOptional()
  timezone?: string;

  @Transform(({ value }) => (value === '' || value === null ? undefined : Number(value)))
  @IsNumber()
  @Min(-180)
  @Max(180)
  @IsOptional()
  longitude?: number;

  @Transform(({ value }) => (value === '' || value === null ? undefined : Number(value)))
  @IsNumber()
  @Min(-90)
  @Max(90)
  @IsOptional()
  latitude?: number;
}
