import { IsMongoId, IsOptional } from 'class-validator';

export class GetProfileDto {
  @IsMongoId()
  @IsOptional()
  userId?: string;
}

export class ProfileResponseDto {
  id!: string;
  userId!: string;
  gender!: string;
  goal!: string;
  fullBodyAnalysis!: any;
  fitPreferences!: any;
  stylePreferences!: any;
  brandPreferences!: any;
  sizing!: any;
  location?: any;
  socialMedia?: any;
  dataRetention!: any;
  createdAt!: Date;
  updatedAt!: Date;
}
