import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Product Schema
 *
 * Persists products from search results with vector embeddings for semantic search.
 * Products are deduplicated based on source + sourceId combination.
 *
 * Vector Embedding: 1536 dimensions (OpenAI text-embedding-3-small)
 * Used for: semantic search, similarity matching, outfit compatibility
 */

// Source types from search
export enum ProductSource {
  OXYLABS = 'oxylabs',
  SHOPSTYLE = 'shopstyle', // Deprecated
  SERPAPI = 'serpapi',
  GOOGLE_SHOPPING = 'google_shopping', // Via SearchAPI.io
  ASOS_SCRAPER = 'asos_scraper',
  ASOS_API = 'asos_api', // ASOS API (not scraper)
  ZARA_SCRAPER = 'zara_scraper',
  HM_SCRAPER = 'hm_scraper',
  BRAVE_SEARCH = 'brave_search', // Brave Search API
  WALMART = 'walmart', // Walmart API
  TARGET = 'target', // Target API
  CLAUDE_WEB = 'claude_web', // Claude Web Search
  CACHE = 'cache',
  MANUAL = 'manual', // User-added products
}

// Product category for filtering
export enum ProductCategory {
  DRESS = 'dress',
  TOP = 'top',
  BOTTOM = 'bottom',
  OUTERWEAR = 'outerwear',
  SHOES = 'shoes',
  BAGS = 'bags',
  ACCESSORIES = 'accessories',
  JEWELRY = 'jewelry',
  SWIMWEAR = 'swimwear',
  ACTIVEWEAR = 'activewear',
  LOUNGEWEAR = 'loungewear',
  OTHER = 'other',
}

// Sub-document for pricing
@Schema({ _id: false })
export class ProductPricing {
  @Prop({ required: true, min: 0 })
  current!: number;

  @Prop({ min: 0 })
  original?: number;

  @Prop({ required: true, default: 'USD' })
  currency!: string;

  @Prop({ default: false })
  onSale!: boolean;

  @Prop({ min: 0, max: 100 })
  discountPercent?: number;

  @Prop()
  priceUpdatedAt?: Date;
}

// Sub-document for product images
@Schema({ _id: false })
export class ProductImages {
  @Prop({ required: true })
  primary!: string;

  @Prop({ type: [String], default: [] })
  gallery!: string[];

  @Prop()
  thumbnail?: string;
}

// Sub-document for ratings
@Schema({ _id: false })
export class ProductRating {
  @Prop({ min: 0, max: 5 })
  average?: number;

  @Prop({ min: 0 })
  count?: number;

  @Prop()
  updatedAt?: Date;
}

// Sub-document for availability
@Schema({ _id: false })
export class ProductAvailability {
  @Prop({ required: true, default: true })
  inStock!: boolean;

  @Prop({ enum: ['low', 'medium', 'high'] })
  stockLevel?: 'low' | 'medium' | 'high';

  @Prop({ type: [String], default: [] })
  sizes!: string[];

  @Prop({ type: [String], default: [] })
  colors!: string[];

  @Prop()
  checkedAt?: Date;
}

// Sub-document for vector embedding
@Schema({ _id: false })
export class ProductEmbedding {
  @Prop({ type: [Number], default: [] })
  vector!: number[]; // 1536 dimensions for OpenAI text-embedding-3-small

  @Prop()
  model?: string; // e.g., 'text-embedding-3-small'

  @Prop()
  generatedAt?: Date;

  @Prop()
  inputText?: string; // The text used to generate embedding (for debugging)
}

// Sub-document for style attributes (AI-extracted)
@Schema({ _id: false })
export class ProductStyle {
  @Prop({ type: [String], default: [] })
  tags!: string[]; // casual, formal, bohemian, etc.

  @Prop({ type: [String], default: [] })
  occasions!: string[]; // work, party, date, casual, etc.

  @Prop({ type: [String], default: [] })
  seasons!: string[]; // spring, summer, fall, winter

  @Prop()
  pattern?: string; // solid, striped, floral, etc.

  @Prop()
  material?: string;

  @Prop()
  fit?: string; // slim, regular, loose, oversized

  @Prop({ default: false })
  sustainable?: boolean;
}

// Sub-document for search/ranking metadata
@Schema({ _id: false })
export class ProductSearchMeta {
  @Prop({ default: 0 })
  viewCount!: number;

  @Prop({ default: 0 })
  clickCount!: number;

  @Prop({ default: 0 })
  saveCount!: number; // Times added to wishlist

  @Prop({ default: 0 })
  purchaseCount!: number; // Times purchased via affiliate

  @Prop({ min: 0, max: 100 })
  relevanceScore?: number;

  @Prop()
  lastSearchedAt?: Date;
}

// Main Product Schema
@Schema({
  timestamps: true,
  collection: 'products',
  toJSON: {
    virtuals: true,
    transform: (doc, ret: any) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      // Don't expose embedding vector in JSON (too large)
      if (ret.embedding) {
        ret.hasEmbedding = ret.embedding.vector?.length > 0;
        delete ret.embedding;
      }
      return ret;
    },
  },
})
export class Product extends Document {
  // Identifiers
  @Prop({ required: true, index: true })
  externalId!: string; // Format: {source}-{sourceId} for deduplication

  @Prop({ required: true })
  sourceId!: string; // Original ID from source

  @Prop({ required: true, enum: ProductSource, index: true })
  source!: ProductSource;

  // Basic info
  @Prop({ required: true, index: 'text' })
  title!: string;

  @Prop({ index: 'text' })
  description?: string;

  @Prop({ index: true })
  brand?: string;

  @Prop({ required: true })
  retailer!: string;

  // Category & Classification
  @Prop({ enum: ProductCategory, index: true })
  category?: ProductCategory;

  @Prop()
  subcategory?: string;

  @Prop()
  color?: string;

  // Pricing
  @Prop({ type: ProductPricing, required: true })
  pricing!: ProductPricing;

  // Images
  @Prop({ type: ProductImages, required: true })
  images!: ProductImages;

  // Links
  @Prop({ required: true })
  productUrl!: string;

  @Prop()
  affiliateUrl?: string;

  // Ratings
  @Prop({ type: ProductRating })
  rating?: ProductRating;

  // Availability
  @Prop({ type: ProductAvailability, required: true })
  availability!: ProductAvailability;

  // Style attributes
  @Prop({ type: ProductStyle })
  style?: ProductStyle;

  // Vector embedding for semantic search
  @Prop({ type: ProductEmbedding })
  embedding?: ProductEmbedding;

  // Search/ranking metadata
  @Prop({ type: ProductSearchMeta, default: {} })
  searchMeta!: ProductSearchMeta;

  // Data freshness
  @Prop({ required: true })
  scrapedAt!: Date;

  @Prop()
  lastVerifiedAt?: Date;

  @Prop({ default: false })
  isStale!: boolean;

  // Soft delete
  @Prop({ default: false })
  isDeleted!: boolean;

  @Prop()
  deletedAt?: Date;

  // Timestamps (auto)
  createdAt!: Date;
  updatedAt!: Date;
}

export const ProductSchema = SchemaFactory.createForClass(Product);

// Compound Indexes for common queries
// Unique constraint for deduplication
ProductSchema.index({ source: 1, sourceId: 1 }, { unique: true });

// For browsing/filtering
ProductSchema.index({ isDeleted: 1, category: 1, 'pricing.current': 1 });
ProductSchema.index({ isDeleted: 1, brand: 1, category: 1 });
ProductSchema.index({ isDeleted: 1, 'style.tags': 1 });
ProductSchema.index({ isDeleted: 1, 'style.occasions': 1 });
ProductSchema.index({ isDeleted: 1, 'style.seasons': 1 });

// For popularity/trending
ProductSchema.index({ isDeleted: 1, 'searchMeta.viewCount': -1 });
ProductSchema.index({ isDeleted: 1, 'searchMeta.saveCount': -1 });
ProductSchema.index({ isDeleted: 1, createdAt: -1 });

// For price filtering
ProductSchema.index({ isDeleted: 1, 'pricing.current': 1, 'pricing.onSale': 1 });

// For stale data cleanup
ProductSchema.index({ isStale: 1, lastVerifiedAt: 1 });

// Text search index
ProductSchema.index(
  { title: 'text', description: 'text', brand: 'text' },
  { weights: { title: 10, brand: 5, description: 1 } }
);

// Note: Vector search index should be created via Atlas Search or MongoDB Vector Search
// For self-hosted, consider using a separate vector DB (Pinecone, Weaviate, Milvus)
// Example Atlas Search index definition (create via Atlas UI or CLI):
/*
{
  "type": "vectorSearch",
  "definition": {
    "fields": [
      {
        "type": "vector",
        "path": "embedding.vector",
        "numDimensions": 1536,
        "similarity": "cosine"
      }
    ]
  }
}
*/

// TTL index for auto-deletion of stale products after 90 days
ProductSchema.index(
  { updatedAt: 1 },
  {
    expireAfterSeconds: 90 * 24 * 60 * 60,
    partialFilterExpression: { isStale: true },
  }
);
