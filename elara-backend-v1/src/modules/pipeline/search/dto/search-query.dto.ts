/**
 * Search Query DTO
 *
 * Represents a normalized search query that can be sent to various search sources.
 * Built from user intent and filters extracted by Claude.
 */

export interface SearchQuery {
  // Core search terms
  terms: string; // Main search keywords (e.g., "summer dress")

  // Product filters
  category?: string; // dress, top, bottom, shoes, accessories, etc.
  gender?: 'male' | 'female' | 'unisex';
  itemType?: string; // Specific item (e.g., "jeans", "t-shirt")

  // Style filters
  style?: string; // minimal, bohemian, edgy, vintage, etc.
  occasion?: string; // casual, formal, business, party, date, workout, travel

  // Physical attributes
  color?: string[]; // ["black", "white"]
  size?: string[]; // ["S", "M", "L"]
  fit?: string; // regular, slim, relaxed, oversized

  // Brand filters
  brands?: string[]; // ["Nike", "Adidas"]

  // Price filters
  minPrice?: number;
  maxPrice?: number;

  // Additional filters
  material?: string[]; // ["cotton", "silk"]
  pattern?: string; // solid, striped, floral
  sustainable?: boolean; // Eco-friendly brands only

  // Pagination
  limit?: number; // Default: 50
  offset?: number; // Default: 0

  // Metadata
  userId?: string; // For personalization
  sessionId?: string; // For tracking
  timestamp?: Date;
}

export interface SearchFilters {
  occasion?: string;
  itemType?: string;
  color?: string[];
  brand?: string[];
  priceRange?: {
    min?: number;
    max?: number;
  };
  style?: string;
  gender?: string;
  size?: string;
  features?: string[];
}

/**
 * Convert IntentClassification filters to SearchQuery
 * CRITICAL: Uses extracted itemType as primary search terms for better results
 */
export function buildSearchQuery(
  terms: string,
  filters: SearchFilters,
  userContext?: any,
): SearchQuery {
  // CRITICAL FIX: Use extracted itemType as primary search terms if available
  // The raw message is too conversational for good search results
  let searchTerms: string;

  if (filters.itemType) {
    // Build search terms from extracted filters (much better than raw message)
    const termParts: string[] = [];

    // Determine if this is a clothing item vs accessory
    // Accessories should NOT include size/features from clothing items
    const clothingTypes = [
      'dress', 'top', 'shirt', 'blouse', 'pants', 'jeans', 'skirt',
      'shorts', 'jacket', 'coat', 'sweater', 'cardigan', 'blazer',
      'jumpsuit', 'romper', 'gown', 'bodysuit',
    ];
    const itemTypeLower = filters.itemType.toLowerCase();
    const isClothingItem = clothingTypes.some(ct => itemTypeLower.includes(ct));

    // Add colors first (e.g., "red dress" not "dress red")
    // ONLY add color for clothing items, not accessories (accessories have their own colors)
    if (filters.color?.length && isClothingItem) {
      termParts.push(...filters.color.slice(0, 2));
    }

    // Add the main item type
    termParts.push(filters.itemType);

    // Add style descriptor (only for clothing items)
    if (filters.style && isClothingItem) {
      termParts.push(filters.style);
    }

    // Add size/fit ONLY for clothing items (not for accessories like shoes, bags, jewelry)
    if (filters.size && isClothingItem) {
      termParts.push(filters.size);
    }

    // Add specific features ONLY for clothing items (e.g., "with sleeves")
    if (filters.features?.length && isClothingItem) {
      termParts.push(...filters.features.slice(0, 2));
    }

    searchTerms = termParts.join(' ');
  } else {
    // Fallback: clean the raw message
    searchTerms = cleanSearchTerms(terms);
  }

  const query: SearchQuery = {
    terms: searchTerms,
    limit: 50,
    offset: 0,
    timestamp: new Date(),
  };

  // Apply filters from intent classification
  if (filters.occasion) query.occasion = filters.occasion;
  if (filters.itemType) query.itemType = filters.itemType;
  if (filters.color?.length) query.color = filters.color;
  if (filters.brand?.length) query.brands = filters.brand;
  if (filters.style) query.style = filters.style;
  if (filters.gender) query.gender = filters.gender as any;
  if (filters.size) query.size = [filters.size];

  // Apply price range
  if (filters.priceRange) {
    query.minPrice = filters.priceRange.min;
    query.maxPrice = filters.priceRange.max;
  }

  // Apply user context defaults
  if (userContext?.profile) {
    const profile = userContext.profile;

    // Default gender if not specified (CRITICAL for relevant results)
    if (!query.gender && profile.gender) {
      query.gender = profile.gender.toLowerCase() === 'female' ? 'female' :
                     profile.gender.toLowerCase() === 'male' ? 'male' : 'unisex';
    }

    // Default price range from profile if not specified
    if (!query.minPrice && !query.maxPrice && profile.priceRange) {
      query.minPrice = profile.priceRange.min;
      query.maxPrice = profile.priceRange.max;
    }

    // Add user ID for tracking
    if (userContext.userId) {
      query.userId = userContext.userId;
    }
  }

  return query;
}

/**
 * Clean search terms by removing conversational words and normalizing
 * This improves search quality by focusing on actual product-related terms
 */
function cleanSearchTerms(terms: string): string {
  let cleaned = terms.toLowerCase().trim();

  // Remove common conversational prefixes
  const conversationalPrefixes = [
    'in general',
    'generally',
    'typically',
    'usually',
    'what looks good with',
    'what looks good under',
    'what goes with',
    'what matches',
    'what colors go with',
    'what should i wear',
    'what can i wear',
    'show me',
    'find me',
    'i need',
    'i want',
    'i\'m looking for',
    'looking for',
    'can you find',
    'can you show',
    'search for',
    'please find',
    'please show',
    'help me find',
  ];

  for (const prefix of conversationalPrefixes) {
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length).trim();
    }
  }

  // Remove filler words that don't help search
  const fillerWords = [
    'a', 'an', 'the', 'some', 'any', 'good', 'nice', 'great', 'perfect',
    'please', 'thanks', 'thank you', 'i think', 'maybe', 'perhaps',
    'something', 'anything', 'stuff', 'things',
  ];

  const words = cleaned.split(/\s+/);
  const filteredWords = words.filter(word => !fillerWords.includes(word));

  // If filtering removed all words, use original (minus conversational prefix)
  if (filteredWords.length === 0) {
    return cleaned;
  }

  // Rejoin and clean up
  cleaned = filteredWords.join(' ').trim();

  // Remove extra whitespace
  cleaned = cleaned.replace(/\s+/g, ' ');

  // Remove trailing punctuation
  cleaned = cleaned.replace(/[?!.,;:]+$/, '').trim();

  return cleaned || terms.toLowerCase().trim();
}
