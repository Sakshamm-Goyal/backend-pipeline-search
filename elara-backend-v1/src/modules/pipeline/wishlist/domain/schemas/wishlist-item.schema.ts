import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Wishlist Item Schema
 *
 * Stores products saved by users for later viewing/purchase.
 * Links to the Product collection for full product details.
 *
 * Features:
 * - User-product relationship
 * - Price tracking for alerts
 * - Organization via collections/folders
 * - Notes and priority
 */

// Sub-document for price tracking
@Schema({ _id: false })
export class PriceHistory {
  @Prop({ required: true })
  price!: number;

  @Prop({ required: true })
  currency!: string;

  @Prop({ required: true, default: () => new Date() })
  recordedAt!: Date;

  @Prop()
  source?: string;
}

// Sub-document for user notes
@Schema({ _id: false })
export class WishlistNotes {
  @Prop()
  text?: string;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop()
  priority?: 'low' | 'medium' | 'high';

  @Prop()
  occasion?: string; // What they want it for

  @Prop()
  updatedAt?: Date;
}

// Main Wishlist Item Schema
@Schema({
  timestamps: true,
  collection: 'wishlist_items',
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
export class WishlistItem extends Document {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, ref: 'Product', index: true })
  productId!: Types.ObjectId;

  // Denormalized product info (for fast display without joins)
  @Prop({ required: true })
  productTitle!: string;

  @Prop()
  productBrand?: string;

  @Prop({ required: true })
  productImageUrl!: string;

  @Prop({ required: true })
  productUrl!: string;

  @Prop()
  productCategory?: string;

  // Current price at time of save
  @Prop({ required: true })
  savedPrice!: number;

  @Prop({ required: true, default: 'USD' })
  savedCurrency!: string;

  // Price tracking
  @Prop({ type: [PriceHistory], default: [] })
  priceHistory!: PriceHistory[];

  @Prop()
  currentPrice?: number; // Updated by background job

  @Prop()
  priceDropPercent?: number; // Calculated when price drops

  @Prop({ default: false })
  hasPriceAlert!: boolean;

  @Prop()
  alertThreshold?: number; // Alert if price drops below this

  // Organization
  @Prop()
  collectionName?: string; // User-defined folder/collection

  @Prop({ type: WishlistNotes })
  notes?: WishlistNotes;

  // Source tracking
  @Prop()
  addedFrom?: string; // search, chat, recommendation, etc.

  @Prop()
  conversationId?: string; // If added from chat

  // Status
  @Prop({ default: false })
  isPurchased!: boolean;

  @Prop()
  purchasedAt?: Date;

  @Prop({ default: false })
  isDeleted!: boolean;

  @Prop()
  deletedAt?: Date;

  // Timestamps (auto)
  createdAt!: Date;
  updatedAt!: Date;
}

export const WishlistItemSchema = SchemaFactory.createForClass(WishlistItem);

// Compound Indexes
// Unique per user-product combination
WishlistItemSchema.index({ userId: 1, productId: 1 }, { unique: true });

// For listing user's wishlist
WishlistItemSchema.index({ userId: 1, isDeleted: 1, createdAt: -1 });

// For filtering by collection
WishlistItemSchema.index({ userId: 1, isDeleted: 1, collectionName: 1 });

// For price drop alerts
WishlistItemSchema.index({ hasPriceAlert: 1, isDeleted: 1 });

// For purchased items
WishlistItemSchema.index({ userId: 1, isPurchased: 1, purchasedAt: -1 });

// For analytics
WishlistItemSchema.index({ productId: 1, isDeleted: 1 });
