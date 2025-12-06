/**
 * Product DTO
 *
 * Normalized product representation from various search sources.
 * All sources map their responses to this structure.
 */

export interface Product {
  // Identifiers
  id: string; // Unique ID (source + original ID)
  sourceId: string; // Original ID from source
  source: SearchSource; // Where this product came from

  // Basic info
  title: string;
  description?: string;
  brand?: string;
  retailer: string; // Store name (ASOS, Zara, etc.)

  // Pricing
  price: number; // Current price in USD
  originalPrice?: number; // Original price (if on sale)
  currency: string; // USD, EUR, GBP, etc.
  onSale: boolean;
  discount?: number; // Percentage off (e.g., 20 for 20% off)

  // Images
  imageUrl: string; // Primary image
  images?: string[]; // Additional images
  thumbnail?: string; // Thumbnail URL

  // Product details
  category?: string; // dress, top, bottom, shoes, etc.
  color?: string; // Primary color
  colors?: string[]; // Available colors
  sizes?: string[]; // Available sizes
  material?: string;
  pattern?: string; // solid, striped, floral, etc.

  // Links
  productUrl: string; // Direct link to product page
  affiliateUrl?: string; // Affiliate link (for commission)

  // Ratings & reviews
  rating?: number; // Average rating (0-5)
  reviewCount?: number; // Number of reviews

  // Availability
  inStock: boolean;
  stockLevel?: 'low' | 'medium' | 'high';

  // Metadata
  tags?: string[]; // Style tags (casual, formal, summer, etc.)
  sustainable?: boolean; // Eco-friendly flag

  // Enrichment (added by ranking)
  score?: number; // Relevance score (0-100)
  rankReason?: string; // Why this product was ranked here

  // Timing
  scrapedAt: Date;
  lastUpdated?: Date;
}

export enum SearchSource {
  OXYLABS = 'oxylabs',
  SHOPSTYLE = 'shopstyle', // Deprecated - kept for backwards compatibility
  SERPAPI = 'serpapi', // SerpAPI Google Shopping - ShopStyle replacement
  ASOS_SCRAPER = 'asos_scraper',
  ZARA_SCRAPER = 'zara_scraper',
  HM_SCRAPER = 'hm_scraper',
  GOOGLE_SHOPPING = 'google_shopping', // Direct Google Shopping API
  BRAVE_SEARCH = 'brave_search', // Brave Search API
  WALMART = 'walmart', // Walmart API
  TARGET = 'target', // Target API
  CLAUDE_WEB = 'claude_web', // Claude Web Search
  CACHE = 'cache',
}

export interface SearchResult {
  products: Product[];
  totalFound: number;
  page: number;
  perPage: number;
  sources: SearchSource[]; // Which sources were used
  timing: {
    total: number; // Total time in ms
    bySource: Record<string, number>; // Time per source
  };
  metadata?: {
    query: string;
    filters: any;
    cacheHit: boolean;
  };
}

/**
 * Create a normalized Product from raw source data
 */
export function normalizeProduct(
  sourceData: any,
  source: SearchSource,
): Product {
  // Base product structure
  const product: Product = {
    id: `${source}-${sourceData.id || sourceData._id || Date.now()}`,
    sourceId: sourceData.id || sourceData._id,
    source,
    title: sourceData.title || sourceData.name || 'Unknown Product',
    brand: sourceData.brand,
    retailer: sourceData.retailer || getRetailerFromSource(source),
    price: parsePrice(sourceData.price),
    currency: sourceData.currency || 'USD',
    onSale: sourceData.onSale || sourceData.discount > 0 || false,
    imageUrl: sourceData.image || sourceData.imageUrl || '',
    productUrl: sourceData.url || sourceData.productUrl || '',
    inStock: sourceData.inStock !== false, // Default to true
    scrapedAt: new Date(),
  };

  // Optional fields
  if (sourceData.description) product.description = sourceData.description;
  if (sourceData.originalPrice)
    product.originalPrice = parsePrice(sourceData.originalPrice);
  if (sourceData.images) product.images = sourceData.images;
  if (sourceData.category) product.category = sourceData.category;
  if (sourceData.color) product.color = sourceData.color;
  if (sourceData.colors) product.colors = sourceData.colors;
  if (sourceData.sizes) product.sizes = sourceData.sizes;
  if (sourceData.rating) product.rating = sourceData.rating;
  if (sourceData.reviewCount) product.reviewCount = sourceData.reviewCount;
  if (sourceData.affiliateUrl) product.affiliateUrl = sourceData.affiliateUrl;
  if (sourceData.tags) product.tags = sourceData.tags;

  // Calculate discount if on sale
  if (product.onSale && product.originalPrice && product.price) {
    product.discount = Math.round(
      ((product.originalPrice - product.price) / product.originalPrice) * 100,
    );
  }

  return product;
}

function getRetailerFromSource(source: SearchSource): string {
  const map: Record<SearchSource, string> = {
    [SearchSource.OXYLABS]: 'Various',
    [SearchSource.SHOPSTYLE]: 'Various',
    [SearchSource.SERPAPI]: 'Various',
    [SearchSource.ASOS_SCRAPER]: 'ASOS',
    [SearchSource.ZARA_SCRAPER]: 'Zara',
    [SearchSource.HM_SCRAPER]: 'H&M',
    [SearchSource.GOOGLE_SHOPPING]: 'Various',
    [SearchSource.BRAVE_SEARCH]: 'Various',
    [SearchSource.WALMART]: 'Walmart',
    [SearchSource.TARGET]: 'Target',
    [SearchSource.CLAUDE_WEB]: 'Various',
    [SearchSource.CACHE]: 'Various',
  };
  return map[source] || 'Unknown';
}

function parsePrice(price: any): number {
  if (typeof price === 'number') return price;
  if (typeof price === 'string') {
    // Remove currency symbols and commas
    const cleaned = price.replace(/[$€£,]/g, '');
    return parseFloat(cleaned) || 0;
  }
  return 0;
}
