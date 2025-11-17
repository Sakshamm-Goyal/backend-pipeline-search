import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Gender } from '../enums/gender.enum';
import { OnboardingGoal } from '../enums/onboarding-goal.enum';
import { SkinUndertone } from '../enums/skin-undertone.enum';
import { BodyType } from '../enums/body-type.enum';
import { StyleTag } from '../enums/style-tag.enum';
import {
  TopFit,
  BottomFit,
  WaistPreference,
  SleeveFit,
  TopLength,
  BottomLength,
} from '../enums/fit-preferences.enum';
import { SizingRegion } from '../enums/sizing-region.enum';
import { Currency } from '../../../shared/domain/enums/currency.enum';

// Sub-document for AI-extracted full body analysis
@Schema({ _id: false })
export class AIExtractedData {
  @Prop()
  skinUndertone?: SkinUndertone;

  @Prop()
  bodyType?: BodyType;

  @Prop()
  heightCm?: number;

  @Prop({ min: 0, max: 1 })
  confidence?: number; // 0-1 confidence score for AI analysis
}

// Sub-document for user overrides
@Schema({ _id: false })
export class UserOverrides {
  @Prop()
  skinUndertone?: SkinUndertone;

  @Prop()
  bodyType?: BodyType;

  @Prop()
  heightCm?: number;
}

// Sub-document for final computed data
@Schema({ _id: false })
export class FinalData {
  @Prop()
  skinUndertone?: SkinUndertone;

  @Prop()
  bodyType?: BodyType;

  @Prop()
  heightCm?: number;
}

// Sub-document for full body analysis (Step 2)
@Schema({ _id: false })
export class FullBodyAnalysis {
  @Prop({ required: true })
  imageUrl!: string;

  @Prop({ required: true })
  imageKey!: string;

  @Prop({ type: AIExtractedData })
  aiExtracted?: AIExtractedData;

  @Prop({ type: UserOverrides })
  userOverrides?: UserOverrides;

  @Prop({ type: FinalData })
  final?: FinalData;

  @Prop()
  uploadedAt!: Date;
}

// Sub-document for fit preferences (Step 3)
@Schema({ _id: false })
export class FitPreferences {
  @Prop({ enum: TopFit })
  topFit?: TopFit;

  @Prop({ enum: BottomFit })
  bottomFit?: BottomFit;

  @Prop({ enum: WaistPreference })
  waistPreference?: WaistPreference;

  @Prop({ enum: SleeveFit })
  sleeveFit?: SleeveFit;

  @Prop({ enum: TopLength })
  topLength?: TopLength;

  @Prop({ enum: BottomLength })
  bottomLength?: BottomLength;

  @Prop()
  additionalNotes?: string;
}

// Sub-document for style preferences (Step 4)
@Schema({ _id: false })
export class StylePreferences {
  @Prop({ type: [String], enum: StyleTag, default: [] })
  selectedStyles!: StyleTag[];

  @Prop({ enum: StyleTag })
  primaryStyle?: StyleTag;

  @Prop({ type: [String], enum: StyleTag, default: [] })
  avoidStyles!: StyleTag[];

  @Prop({ type: [String], default: [] })
  colorPreferences!: string[]; // Hex color codes

  @Prop({ type: [String], default: [] })
  avoidColors!: string[]; // Hex color codes

  @Prop()
  modestDressing?: boolean;

  @Prop()
  religiousRestrictions?: string;

  @Prop()
  otherRestrictions?: string;
}

// Sub-document for brand preferences (Step 5)
@Schema({ _id: false })
export class BrandPreferences {
  @Prop({ type: [String], default: [] })
  likedBrands!: string[];

  @Prop({ type: [String], default: [] })
  customBrands!: string[]; // User-added brands not in the predefined list

  @Prop({ type: [String], default: [] })
  dislikedBrands!: string[];

  @Prop({
    type: {
      min: { type: Number },
      max: { type: Number },
      currency: { type: String, enum: Object.values(Currency), default: Currency.USD },
    },
  })
  priceRange?: {
    min?: number;
    max?: number;
    currency: Currency;
  };
}

// Sub-document for measurements
@Schema({ _id: false })
export class Measurements {
  @Prop()
  bust?: number; // in cm

  @Prop()
  waist?: number;

  @Prop()
  hips?: number;

  @Prop()
  inseam?: number;

  @Prop()
  shoulder?: number;

  @Prop()
  sleeveLength?: number;
}

// Sub-document for sizing (Step 6)
@Schema({ _id: false })
export class Sizing {
  @Prop({ enum: SizingRegion, default: SizingRegion.US })
  region!: SizingRegion;

  @Prop()
  tops?: string; // e.g., "S", "M", "L", "XL", "4", "6", "8"

  @Prop()
  bottoms?: string;

  @Prop()
  dresses?: string;

  @Prop()
  shoes?: string; // e.g., "8", "9.5", "42"

  @Prop({ type: Measurements })
  measurements?: Measurements;

  @Prop()
  preferNumericSizing?: boolean; // US: 2, 4, 6 vs S, M, L
}

// Sub-document for location (Step 7)
@Schema({ _id: false })
export class Location {
  @Prop()
  city?: string;

  @Prop()
  state?: string;

  @Prop()
  country?: string;

  @Prop()
  timezone?: string;

  @Prop({
    type: {
      type: String,
      enum: ['Point'],
    },
    coordinates: {
      type: [Number],
    },
  })
  coordinates?: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
}

// Sub-document for social media (Step 8)
@Schema({ _id: false })
export class SocialMedia {
  @Prop()
  instagram?: string; // Username or profile URL
}

// Sub-document for data retention preferences (Step 9 - GDPR)
@Schema({ _id: false })
export class DataRetention {
  @Prop({ required: true })
  consentGiven!: boolean;

  @Prop()
  consentGivenAt?: Date;

  @Prop({ default: false })
  allowDataSharing!: boolean;

  @Prop({ default: false })
  allowAITraining!: boolean;

  @Prop()
  dataExpiryDate?: Date; // When user wants their data deleted (optional)
}

// Main UserProfile Schema
@Schema({
  timestamps: true,
  collection: 'user_profiles',
  toJSON: {
    virtuals: true,
    transform: (doc, ret: any) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class UserProfile extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId!: Types.ObjectId;

  // Step 1: Gender & Goal
  @Prop({ enum: Gender, required: true })
  gender!: Gender;

  @Prop({ enum: OnboardingGoal, required: true })
  goal!: OnboardingGoal;

  // Step 2: Full body analysis
  @Prop({ type: FullBodyAnalysis })
  fullBodyAnalysis?: FullBodyAnalysis;

  // Step 3: Fit preferences
  @Prop({ type: FitPreferences })
  fitPreferences?: FitPreferences;

  // Step 4: Style preferences
  @Prop({ type: StylePreferences })
  stylePreferences?: StylePreferences;

  // Step 5: Brand preferences
  @Prop({ type: BrandPreferences })
  brandPreferences?: BrandPreferences;

  // Step 6: Sizing
  @Prop({ type: Sizing })
  sizing?: Sizing;

  // Step 7: Location
  @Prop({ type: Location })
  location?: Location;

  // Step 8: Social media
  @Prop({ type: SocialMedia })
  socialMedia?: SocialMedia;

  // Step 9: Data retention (GDPR)
  @Prop({ type: DataRetention })
  dataRetention?: DataRetention;

  // Timestamps (automatically added by timestamps: true)
  createdAt!: Date;
  updatedAt!: Date;
}

export const UserProfileSchema = SchemaFactory.createForClass(UserProfile);

// Indexes
UserProfileSchema.index({ userId: 1 }, { unique: true });
UserProfileSchema.index({ gender: 1 });
UserProfileSchema.index({ goal: 1 });
UserProfileSchema.index({ 'stylePreferences.primaryStyle': 1 });
UserProfileSchema.index({ 'stylePreferences.selectedStyles': 1 });
UserProfileSchema.index({ 'brandPreferences.likedBrands': 1 });
UserProfileSchema.index({ 'location.coordinates': '2dsphere' }, { sparse: true }); // For geospatial queries, sparse because not all profiles have coordinates
UserProfileSchema.index({ 'location.city': 1 });
UserProfileSchema.index({ 'location.country': 1 });
UserProfileSchema.index({ createdAt: -1 });
UserProfileSchema.index({ updatedAt: -1 });
