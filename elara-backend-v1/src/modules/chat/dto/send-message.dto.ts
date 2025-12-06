import { IsString, IsNotEmpty, MaxLength, IsUUID, IsOptional, IsObject } from 'class-validator';

export class SearchFiltersDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  priceRange?: { min?: number; max?: number };

  @IsOptional()
  @IsString()
  style?: string;

  @IsOptional()
  @IsString()
  occasion?: string;

  @IsOptional()
  @IsString()
  itemType?: string;

  @IsOptional()
  @IsString()
  brand?: string;
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;

  @IsUUID()
  sessionId!: string;

  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsOptional()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsObject()
  filters?: SearchFiltersDto;
}
