import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Search History Schema
 *
 * Stores user search queries for:
 * - Recent searches display
 * - Search suggestions/autocomplete
 * - Search analytics
 * - Personalization (understanding user interests)
 */

// Sub-document for search filters used
@Schema({ _id: false })
export class SearchFilters {
  @Prop({ type: [String], default: [] })
  categories!: string[];

  @Prop({ type: [String], default: [] })
  brands!: string[];

  @Prop()
  minPrice?: number;

  @Prop()
  maxPrice?: number;

  @Prop({ type: [String], default: [] })
  colors!: string[];

  @Prop({ type: [String], default: [] })
  occasions!: string[];

  @Prop({ type: [String], default: [] })
  styles!: string[];

  @Prop()
  gender?: string;

  @Prop({ type: Object })
  other?: Record<string, any>;
}

// Sub-document for search results summary
@Schema({ _id: false })
export class SearchResultsSummary {
  @Prop({ required: true, default: 0 })
  totalFound!: number;

  @Prop({ required: true, default: 0 })
  displayed!: number;

  @Prop({ type: [String], default: [] })
  sources!: string[];

  @Prop()
  processingTimeMs?: number;

  @Prop({ default: false })
  cacheHit!: boolean;

  // Top categories in results
  @Prop({ type: [String], default: [] })
  topCategories!: string[];

  // Top brands in results
  @Prop({ type: [String], default: [] })
  topBrands!: string[];

  // Price range of results
  @Prop()
  minResultPrice?: number;

  @Prop()
  maxResultPrice?: number;
}

// Sub-document for user interaction with results
@Schema({ _id: false })
export class SearchInteraction {
  @Prop({ default: 0 })
  clickedResults!: number;

  @Prop({ default: 0 })
  savedProducts!: number;

  @Prop({ type: [String], default: [] })
  clickedProductIds!: string[];

  @Prop()
  refinedQuery?: string; // If user refined the search

  @Prop()
  interactionTimeMs?: number; // Time spent on results
}

// Main Search History Schema
@Schema({
  timestamps: true,
  collection: 'search_history',
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
export class SearchHistory extends Document {
  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId!: Types.ObjectId;

  // The search query
  @Prop({ required: true, index: 'text' })
  query!: string;

  // Normalized query (lowercase, trimmed)
  @Prop({ required: true, index: true })
  normalizedQuery!: string;

  // Search context
  @Prop()
  sessionId?: string;

  @Prop()
  conversationId?: string;

  @Prop()
  source?: string; // 'chat', 'search_bar', 'voice', etc.

  // Filters applied
  @Prop({ type: SearchFilters })
  filters?: SearchFilters;

  // Results summary
  @Prop({ type: SearchResultsSummary })
  results?: SearchResultsSummary;

  // User interaction
  @Prop({ type: SearchInteraction })
  interaction?: SearchInteraction;

  // Intent detected
  @Prop()
  detectedIntent?: string;

  @Prop()
  intentConfidence?: number;

  // Timestamps
  @Prop({ required: true, default: () => new Date() })
  searchedAt!: Date;

  // Soft delete
  @Prop({ default: false })
  isDeleted!: boolean;

  @Prop()
  deletedAt?: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const SearchHistorySchema = SchemaFactory.createForClass(SearchHistory);

// Indexes
// For recent searches
SearchHistorySchema.index({ userId: 1, isDeleted: 1, searchedAt: -1 });

// For search suggestions (unique queries per user)
SearchHistorySchema.index({ userId: 1, normalizedQuery: 1 });

// For analytics
SearchHistorySchema.index({ searchedAt: -1 });
SearchHistorySchema.index({ normalizedQuery: 1, searchedAt: -1 });

// Text search for query suggestions
SearchHistorySchema.index({ query: 'text' });

// TTL - auto-delete after 1 year
SearchHistorySchema.index(
  { searchedAt: 1 },
  { expireAfterSeconds: 365 * 24 * 60 * 60 }
);
