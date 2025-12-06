import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * User Event Schema
 *
 * Tracks all user interactions for analytics and personalization.
 * Events are used for:
 * - Building user preference profiles
 * - Improving search ranking
 * - Generating recommendations
 * - Analytics dashboards
 *
 * GDPR Note: Ensure proper consent before tracking. Events can be
 * anonymized or deleted on user request.
 */

export enum EventType {
  // Search events
  SEARCH = 'search',
  SEARCH_CLICK = 'search_click',
  SEARCH_FILTER = 'search_filter',

  // Product events
  PRODUCT_VIEW = 'product_view',
  PRODUCT_CLICK = 'product_click', // Click through to retailer
  PRODUCT_SAVE = 'product_save', // Add to wishlist
  PRODUCT_UNSAVE = 'product_unsave',
  PRODUCT_SHARE = 'product_share',

  // Wardrobe events
  WARDROBE_ADD = 'wardrobe_add',
  WARDROBE_REMOVE = 'wardrobe_remove',
  WARDROBE_VIEW = 'wardrobe_view',

  // Outfit events
  OUTFIT_CREATE = 'outfit_create',
  OUTFIT_VIEW = 'outfit_view',
  OUTFIT_SAVE = 'outfit_save',
  OUTFIT_WEAR = 'outfit_wear', // Mark as worn

  // Chat events
  CHAT_MESSAGE = 'chat_message',
  CHAT_FEEDBACK = 'chat_feedback', // Thumbs up/down

  // Session events
  SESSION_START = 'session_start',
  SESSION_END = 'session_end',

  // Engagement
  PAGE_VIEW = 'page_view',
  FEATURE_USE = 'feature_use',
}

// Sub-document for event context
@Schema({ _id: false })
export class EventContext {
  @Prop()
  sessionId?: string;

  @Prop()
  conversationId?: string;

  @Prop()
  page?: string;

  @Prop()
  source?: string; // Where the action originated (search, chat, wardrobe)

  @Prop()
  deviceType?: string; // mobile, tablet, desktop

  @Prop()
  platform?: string; // ios, android, web

  @Prop()
  referrer?: string;

  @Prop({ type: Object })
  utmParams?: Record<string, string>;
}

// Sub-document for search-related data
@Schema({ _id: false })
export class SearchEventData {
  @Prop()
  query?: string;

  @Prop()
  resultCount?: number;

  @Prop()
  position?: number; // Position in search results when clicked

  @Prop({ type: Object })
  filters?: Record<string, any>;

  @Prop({ type: [String], default: [] })
  sources?: string[]; // Search sources used

  @Prop()
  processingTime?: number;
}

// Sub-document for product-related data
@Schema({ _id: false })
export class ProductEventData {
  @Prop({ index: true })
  productId?: string;

  @Prop()
  externalId?: string; // source-sourceId

  @Prop()
  category?: string;

  @Prop()
  brand?: string;

  @Prop()
  price?: number;

  @Prop()
  source?: string;

  @Prop()
  position?: number; // Position when viewed in list

  @Prop()
  viewDuration?: number; // Seconds spent viewing
}

// Sub-document for wardrobe/outfit data
@Schema({ _id: false })
export class WardrobeEventData {
  @Prop()
  itemId?: string;

  @Prop()
  outfitId?: string;

  @Prop()
  category?: string;

  @Prop({ type: [String], default: [] })
  itemIds?: string[]; // For outfit events

  @Prop()
  action?: string; // Specific action taken
}

// Sub-document for chat data
@Schema({ _id: false })
export class ChatEventData {
  @Prop()
  messageId?: string;

  @Prop()
  intent?: string;

  @Prop()
  feedbackType?: 'positive' | 'negative';

  @Prop()
  agentUsed?: string;

  @Prop()
  responseTime?: number;
}

// Main User Event Schema
@Schema({
  timestamps: true,
  collection: 'user_events',
  timeseries: {
    timeField: 'timestamp',
    metaField: 'userId',
    granularity: 'seconds',
  },
})
export class UserEvent extends Document {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, enum: EventType, index: true })
  eventType!: EventType;

  @Prop({ required: true, default: () => new Date() })
  timestamp!: Date;

  @Prop({ type: EventContext })
  context?: EventContext;

  @Prop({ type: SearchEventData })
  searchData?: SearchEventData;

  @Prop({ type: ProductEventData })
  productData?: ProductEventData;

  @Prop({ type: WardrobeEventData })
  wardrobeData?: WardrobeEventData;

  @Prop({ type: ChatEventData })
  chatData?: ChatEventData;

  @Prop({ type: Object })
  customData?: Record<string, any>;

  // Denormalized user preferences at time of event (for ML training)
  @Prop({ type: Object })
  userSnapshot?: {
    gender?: string;
    stylePreferences?: string[];
    priceRange?: { min: number; max: number };
  };

  // For GDPR compliance
  @Prop({ default: false })
  isAnonymized!: boolean;

  createdAt!: Date;
}

export const UserEventSchema = SchemaFactory.createForClass(UserEvent);

// Indexes for common queries
UserEventSchema.index({ userId: 1, eventType: 1, timestamp: -1 });
UserEventSchema.index({ userId: 1, timestamp: -1 });
UserEventSchema.index({ eventType: 1, timestamp: -1 });
UserEventSchema.index({ 'productData.productId': 1, timestamp: -1 });
UserEventSchema.index({ 'searchData.query': 1, timestamp: -1 });
UserEventSchema.index({ timestamp: -1 });

// TTL index - auto-delete events older than 1 year
UserEventSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 365 * 24 * 60 * 60 }
);

// Index for GDPR deletion
UserEventSchema.index({ userId: 1, isAnonymized: 1 });
