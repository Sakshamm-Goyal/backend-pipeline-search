import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { WardrobeCategory } from '../enums/wardrobe-category.enum';
import { Pattern } from '../enums/pattern.enum';
import { Occasion } from '../enums/occasion.enum';
import { Season } from '../enums/season.enum';
import { ImageProcessingStatus } from '../enums/image-processing-status.enum';
import { StyleTag } from '../../../onboarding/domain/enums/style-tag.enum';
import { Currency } from '../../../shared/domain/enums/currency.enum';

// Sub-document for AI analysis
@Schema({ _id: false })
export class AIAnalysis {
  @Prop()
  dominantColor?: string; // Hex color code

  @Prop({ type: [String], default: [] })
  colorPalette!: string[]; // Array of hex color codes

  @Prop({ enum: Pattern })
  pattern?: Pattern;

  @Prop({ type: [String], enum: StyleTag, default: [] })
  style!: StyleTag[];

  @Prop()
  material?: string; // e.g., cotton, denim, silk

  @Prop({ type: [String], enum: Occasion, default: [] })
  occasion!: Occasion[];

  @Prop({ type: [String], enum: Season, default: [] })
  season!: Season[];

  @Prop({ min: 0, max: 1 })
  confidence?: number; // 0-1 confidence score for AI analysis
}

// Sub-document for image processing status
@Schema({ _id: false })
export class ImageProcessing {
  @Prop({ enum: ImageProcessingStatus, default: ImageProcessingStatus.PENDING })
  status!: ImageProcessingStatus;

  @Prop({ default: false })
  backgroundRemoved!: boolean;

  @Prop({ default: false })
  thumbnailGenerated!: boolean;

  @Prop()
  error?: string;

  @Prop({ default: 0, min: 0, max: 5 })
  retryCount!: number; // Maximum 5 retries

  @Prop()
  processedAt?: Date;
}

// Main WardrobeItem Schema
@Schema({
  timestamps: true,
  collection: 'wardrobe_items',
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
export class WardrobeItem extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  // Basic info
  @Prop({ enum: WardrobeCategory, required: true })
  category!: WardrobeCategory;

  @Prop()
  subcategory?: string; // e.g., "v-neck", "crew-neck" for tshirt

  @Prop()
  name?: string; // User-defined name

  @Prop()
  description?: string;

  // Images
  @Prop({ required: true })
  imageUrl!: string;

  @Prop({ required: true })
  imageKey!: string; // GCS key for deletion

  @Prop()
  processedImageUrl?: string; // Background removed image URL

  @Prop()
  processedImageKey?: string;

  @Prop()
  thumbnailUrl?: string;

  @Prop()
  thumbnailKey?: string;

  // AI Analysis (optional until AI is integrated)
  @Prop({ type: AIAnalysis })
  aiAnalysis?: AIAnalysis;

  // Image processing status
  @Prop({ type: ImageProcessing, required: true })
  imageProcessing!: ImageProcessing;

  // User-defined attributes
  @Prop({ type: [String], default: [] })
  userTags!: string[]; // Custom user tags

  @Prop()
  brand?: string;

  @Prop()
  purchaseDate?: Date;

  @Prop()
  price?: number;

  @Prop({ enum: Currency })
  currency?: Currency;

  @Prop()
  notes?: string;

  // Usage tracking
  @Prop({ default: false })
  isFavorite!: boolean;

  @Prop({ default: 0 })
  timesWorn!: number;

  @Prop()
  lastWornAt?: Date;

  // Outfit references
  @Prop({ type: [Types.ObjectId], ref: 'OutfitCombination', default: [] })
  outfitIds!: Types.ObjectId[];

  // Soft delete
  @Prop({ default: false })
  isDeleted!: boolean;

  @Prop()
  deletedAt?: Date;

  // Timestamps (automatically added by timestamps: true)
  createdAt!: Date;
  updatedAt!: Date;
}

export const WardrobeItemSchema = SchemaFactory.createForClass(WardrobeItem);

// Compound Indexes - Optimized for common query patterns
// Most queries filter by userId and isDeleted together
WardrobeItemSchema.index({ userId: 1, isDeleted: 1, category: 1 }); // For filtering by category
WardrobeItemSchema.index({ userId: 1, isDeleted: 1, isFavorite: 1, createdAt: -1 }); // For favorites list
WardrobeItemSchema.index({ userId: 1, isDeleted: 1, timesWorn: -1 }); // For most/least worn
WardrobeItemSchema.index({ userId: 1, isDeleted: 1, createdAt: -1 }); // For recent items
WardrobeItemSchema.index({ userId: 1, isDeleted: 1 }); // General active items query

// Single field indexes for specific lookups
WardrobeItemSchema.index({ 'aiAnalysis.dominantColor': 1 });
WardrobeItemSchema.index({ 'aiAnalysis.style': 1 });
WardrobeItemSchema.index({ 'aiAnalysis.occasion': 1 });
WardrobeItemSchema.index({ 'aiAnalysis.season': 1 });
WardrobeItemSchema.index({ brand: 1 });
WardrobeItemSchema.index({ userTags: 1 });
WardrobeItemSchema.index({ lastWornAt: -1 });
WardrobeItemSchema.index({ 'imageProcessing.status': 1 });
