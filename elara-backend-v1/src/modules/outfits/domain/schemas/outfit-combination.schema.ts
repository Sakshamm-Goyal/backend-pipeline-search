import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { WardrobeCategory } from '../../../wardrobe/domain/enums/wardrobe-category.enum';
import { Occasion } from '../../../wardrobe/domain/enums/occasion.enum';
import { Season } from '../../../wardrobe/domain/enums/season.enum';

// Sub-document for outfit items
@Schema({ _id: false })
export class OutfitItem {
  @Prop({ type: Types.ObjectId, ref: 'WardrobeItem', required: true })
  wardrobeItemId!: Types.ObjectId;

  @Prop({ enum: WardrobeCategory, required: true })
  category!: WardrobeCategory;

  @Prop()
  subcategory?: string;
}

// Main OutfitCombination Schema
@Schema({
  timestamps: true,
  collection: 'outfit_combinations',
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
export class OutfitCombination extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop()
  description?: string;

  // Wardrobe items in this outfit
  @Prop({ type: [OutfitItem], required: true })
  items!: OutfitItem[];

  // Occasion and season tags
  @Prop({ type: [String], enum: Occasion, default: [] })
  occasion!: Occasion[];

  @Prop({ type: [String], enum: Season, default: [] })
  season!: Season[];

  // AI-generated info (optional)
  @Prop({ default: false })
  aiGenerated!: boolean;

  @Prop({ enum: ['ai', 'user'], default: 'user' })
  createdBy!: 'ai' | 'user';

  @Prop()
  styleScore?: number; // 0-1 confidence score from AI

  @Prop()
  reasoning?: string; // AI explanation for this combination

  // Usage tracking
  @Prop({ default: 0 })
  timesWorn!: number;

  @Prop()
  lastWornAt?: Date;

  @Prop({ default: false })
  isFavorite!: boolean;

  // User notes
  @Prop()
  notes?: string;

  // Soft delete
  @Prop({ default: false })
  isDeleted!: boolean;

  @Prop()
  deletedAt?: Date;

  // Timestamps (automatically added by timestamps: true)
  createdAt!: Date;
  updatedAt!: Date;
}

export const OutfitCombinationSchema =
  SchemaFactory.createForClass(OutfitCombination);

// Indexes
OutfitCombinationSchema.index({ userId: 1, isDeleted: 1 });
OutfitCombinationSchema.index({ userId: 1, isFavorite: 1 });
OutfitCombinationSchema.index({ occasion: 1 });
OutfitCombinationSchema.index({ season: 1 });
OutfitCombinationSchema.index({ aiGenerated: 1 });
OutfitCombinationSchema.index({ createdAt: -1 });
OutfitCombinationSchema.index({ lastWornAt: -1 });
OutfitCombinationSchema.index({ 'items.wardrobeItemId': 1 });
