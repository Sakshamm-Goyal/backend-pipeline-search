import { IsEnum, IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { SkinUndertone } from '../../domain/enums/skin-undertone.enum';
import { BodyType } from '../../domain/enums/body-type.enum';

export class Step2BodyAnalysisDto {
  @IsEnum(SkinUndertone)
  @IsOptional()
  skinUndertone?: SkinUndertone;

  @IsEnum(BodyType)
  @IsOptional()
  bodyType?: BodyType;

  @Transform(({ value }) => (value ? Number(value) : value))
  @IsNumber()
  @Min(100)
  @Max(250)
  @IsOptional()
  heightCm?: number;
}

export class Step2BodyAnalysisResponseDto {
  @IsString()
  imageUrl!: string;

  @IsString()
  imageKey!: string;

  @IsOptional()
  aiExtracted?: {
    skinUndertone?: SkinUndertone;
    bodyType?: BodyType;
    heightCm?: number;
    confidence?: number;
  };

  @IsOptional()
  userOverrides?: Step2BodyAnalysisDto;

  final!: {
    skinUndertone: SkinUndertone;
    bodyType: BodyType;
    heightCm?: number;
  };

  uploadedAt!: Date;
}
