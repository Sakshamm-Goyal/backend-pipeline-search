import { Injectable, Logger } from '@nestjs/common';
import { SearchQuery } from './dto/search-query.dto';
import { SearchSource } from './dto/product.dto';

/**
 * Query Builder Service
 *
 * Transforms normalized SearchQuery into source-specific query formats.
 * Each search source has different requirements and query syntax.
 */
@Injectable()
export class QueryBuilderService {
  private readonly logger = new Logger(QueryBuilderService.name);

  /**
   * Build query string for Oxylabs Google Shopping API
   */
  buildOxylabsQuery(query: SearchQuery): string {
    // CRITICAL: Log what we receive BEFORE any processing (use LOG level for visibility)
    this.logger.log(`[QueryBuilder] OXYLABS INPUT: terms="${query.terms}", itemType="${query.itemType}", category="${query.category}"`);

    const parts: string[] = [query.terms];

    // CRITICAL FIX: Don't add itemType if it's already included in terms
    // The buildSearchQuery function already includes itemType in terms
    // Adding it again causes duplication like "party heels strappy heels party heels strappy heels"
    const termsLower = query.terms.toLowerCase();
    const itemTypeLower = query.itemType?.toLowerCase() || '';
    const shouldAddItemType = query.itemType && !termsLower.includes(itemTypeLower);

    // Add category/item type only if not already in terms
    if (shouldAddItemType) {
      parts.push(query.itemType!);
    } else if (query.category && !termsLower.includes(query.category.toLowerCase())) {
      parts.push(query.category);
    }

    // Add gender if not already in terms
    if (query.gender && !termsLower.includes(query.gender.toLowerCase())) {
      parts.push(`${query.gender}'s`);
    }

    // Add style if not already in terms
    if (query.style && !termsLower.includes(query.style.toLowerCase())) {
      parts.push(query.style);
    }

    // Add colors only if not already in terms (limit to 2)
    if (query.color?.length) {
      const newColors = query.color.filter(c => !termsLower.includes(c.toLowerCase()));
      if (newColors.length > 0) {
        const colors = newColors.slice(0, 2).join(' or ');
        parts.push(colors);
      }
    }

    // Add brands (limit to 3)
    if (query.brands?.length) {
      const brands = query.brands.slice(0, 3).join(' OR ');
      parts.push(`(${brands})`);
    }

    const queryString = parts.join(' ');
    this.logger.debug(`Oxylabs query: "${queryString}"`);
    return queryString;
  }

  /**
   * Build query parameters for ShopStyle API
   */
  buildShopStyleQuery(query: SearchQuery): Record<string, any> {
    const params: Record<string, any> = {
      fts: query.terms, // Full-text search
      offset: query.offset || 0,
      limit: query.limit || 50,
    };

    // Category mapping (ShopStyle specific)
    if (query.category) {
      params.cat = this.mapCategoryToShopStyle(query.category);
    }

    // Gender filter
    if (query.gender) {
      params.fl = this.mapGenderToShopStyle(query.gender);
    }

    // Price range
    if (query.minPrice || query.maxPrice) {
      const min = query.minPrice || 0;
      const max = query.maxPrice || 10000;
      params.price = `${min}:${max}`;
    }

    // Brand filter
    if (query.brands?.length) {
      // ShopStyle uses brand IDs, but we can try brand names in fts
      const brandQuery = query.brands.join(' OR ');
      params.fts = `${params.fts} (${brandQuery})`;
    }

    // Color filter
    if (query.color?.length) {
      params.colors = query.color.join(',');
    }

    this.logger.debug(`ShopStyle params:`, params);
    return params;
  }

  /**
   * Build query string for SearchAPI.io Google Shopping
   */
  buildSearchApiQuery(query: SearchQuery): string {
    const parts: string[] = [query.terms];

    // CRITICAL FIX: Don't add duplicates - check if already in terms
    const termsLower = query.terms.toLowerCase();
    const itemTypeLower = query.itemType?.toLowerCase() || '';
    const shouldAddItemType = query.itemType && !termsLower.includes(itemTypeLower);

    // Add category/item type only if not already in terms
    if (shouldAddItemType) {
      parts.push(query.itemType!);
    } else if (query.category && !termsLower.includes(query.category.toLowerCase())) {
      parts.push(query.category);
    }

    // Add gender if not already in terms
    if (query.gender && !termsLower.includes(query.gender.toLowerCase())) {
      parts.push(`${query.gender}'s`);
    }

    // Add style if not already in terms
    if (query.style && !termsLower.includes(query.style.toLowerCase())) {
      parts.push(query.style);
    }

    // Add colors only if not already in terms (limit to 2)
    if (query.color?.length) {
      const newColors = query.color.filter(c => !termsLower.includes(c.toLowerCase()));
      if (newColors.length > 0) {
        const colors = newColors.slice(0, 2).join(' or ');
        parts.push(colors);
      }
    }

    // Add brands (limit to 3)
    if (query.brands?.length) {
      const brands = query.brands.slice(0, 3).join(' OR ');
      parts.push(`(${brands})`);
    }

    const queryString = parts.join(' ');
    this.logger.debug(`SearchAPI query: "${queryString}"`);
    return queryString;
  }

  /**
   * Build query params for ASOS API (not URL-based)
   */
  buildAsosParams(query: SearchQuery): Record<string, any> {
    const params: Record<string, any> = {
      q: query.terms,
      offset: query.offset || 0,
      limit: Math.min(query.limit || 50, 72), // ASOS max is 72
      store: 'US',
      lang: 'en-US',
      currency: 'USD',
    };

    // Add item type to search query
    if (query.itemType) {
      params.q = `${params.q} ${query.itemType}`;
    }

    // Add style to search query
    if (query.style) {
      params.q = `${params.q} ${query.style}`;
    }

    // Gender filter (ASOS uses floor codes)
    if (query.gender) {
      params.floor = query.gender.toLowerCase() === 'male' ? 1002 : 1001;
    }

    // Price range
    if (query.minPrice || query.maxPrice) {
      const min = query.minPrice || 0;
      const max = query.maxPrice || 500;
      params.base_price = `${min}-${max}`;
    }

    // Color filter
    if (query.color?.length) {
      const colorCodes = query.color
        .map(c => this.mapColorToAsosId(c))
        .filter(Boolean)
        .join(',');
      if (colorCodes) {
        params.attribute_1046 = colorCodes;
      }
    }

    this.logger.debug(`ASOS params:`, params);
    return params;
  }

  /**
   * Build search URL for ASOS scraper
   */
  buildAsosUrl(query: SearchQuery): string {
    const baseUrl = 'https://www.asos.com';

    // Build search path based on gender
    let genderPath = '/women'; // default
    if (query.gender === 'male') genderPath = '/men';

    // Start with search endpoint
    let url = `${baseUrl}${genderPath}/search`;

    // Build query parameters
    const params = new URLSearchParams();

    // Main search query
    let searchTerms = query.terms;
    if (query.itemType) searchTerms += ` ${query.itemType}`;
    if (query.style) searchTerms += ` ${query.style}`;
    params.append('q', searchTerms);

    // Price range
    if (query.minPrice) {
      params.append('priceMin', query.minPrice.toString());
    }
    if (query.maxPrice) {
      params.append('priceMax', query.maxPrice.toString());
    }

    // Brand filter (ASOS uses brand IDs, but we'll try names in search)
    if (query.brands?.length) {
      // Add to search query
      const brandQuery = query.brands.join(' ');
      params.set('q', `${params.get('q')} ${brandQuery}`);
    }

    // Color filter (ASOS uses color IDs)
    if (query.color?.length) {
      // Map colors to ASOS color families
      const colorIds = query.color
        .map(c => this.mapColorToAsosId(c))
        .filter(Boolean)
        .join(',');
      if (colorIds) {
        params.append('base_colour', colorIds);
      }
    }

    // Pagination
    params.append('offset', (query.offset || 0).toString());
    params.append('limit', (query.limit || 50).toString());

    // Sort by relevance
    params.append('sort', 'relevancy');

    const fullUrl = `${url}?${params.toString()}`;
    this.logger.debug(`ASOS URL: ${fullUrl}`);
    return fullUrl;
  }

  /**
   * Build search URL for Zara scraper
   */
  buildZaraUrl(query: SearchQuery): string {
    const baseUrl = 'https://www.zara.com/us/en';

    // Zara has gender-specific sections
    let section = 'woman'; // default
    if (query.gender === 'male') section = 'man';

    // Build search URL
    const searchTerms = this.buildGenericSearchTerms(query);
    const encodedTerms = encodeURIComponent(searchTerms);

    const url = `${baseUrl}/search?searchTerm=${encodedTerms}&section=${section}`;

    this.logger.debug(`Zara URL: ${url}`);
    return url;
  }

  /**
   * Build search URL for H&M scraper
   */
  buildHmUrl(query: SearchQuery): string {
    const baseUrl = 'https://www2.hm.com/en_us';

    // H&M gender sections
    let section = 'ladies';
    if (query.gender === 'male') section = 'men';

    // Build search query
    const searchTerms = this.buildGenericSearchTerms(query);
    const encodedTerms = encodeURIComponent(searchTerms);

    const url = `${baseUrl}/${section}/search-results.html?q=${encodedTerms}`;

    // Add filters as URL parameters
    const params = new URLSearchParams();

    if (query.minPrice) {
      params.append('priceMin', query.minPrice.toString());
    }
    if (query.maxPrice) {
      params.append('priceMax', query.maxPrice.toString());
    }

    // Pagination
    params.append('page-size', (query.limit || 50).toString());
    params.append('offset', (query.offset || 0).toString());

    const fullUrl = params.toString() ? `${url}&${params.toString()}` : url;

    this.logger.debug(`H&M URL: ${fullUrl}`);
    return fullUrl;
  }

  /**
   * Build generic search terms from query
   * Used for scrapers that don't have complex filtering
   */
  private buildGenericSearchTerms(query: SearchQuery): string {
    const parts: string[] = [query.terms];

    if (query.itemType) parts.push(query.itemType);
    if (query.style) parts.push(query.style);
    if (query.color?.length) parts.push(query.color[0]); // Just first color
    if (query.brands?.length) parts.push(query.brands[0]); // Just first brand

    return parts.join(' ');
  }

  /**
   * Map category to ShopStyle category code
   */
  private mapCategoryToShopStyle(category: string): string {
    const map: Record<string, string> = {
      dress: 'dresses',
      top: 'tops',
      bottom: 'bottoms',
      jeans: 'jeans',
      pants: 'pants',
      shorts: 'shorts',
      skirt: 'skirts',
      shoes: 'shoes',
      sneakers: 'sneakers',
      boots: 'boots',
      heels: 'heels',
      jacket: 'jackets',
      coat: 'coats',
      sweater: 'sweaters',
      accessories: 'accessories',
      bag: 'bags',
      jewelry: 'jewelry',
    };

    return map[category.toLowerCase()] || category;
  }

  /**
   * Map gender to ShopStyle filter code
   */
  private mapGenderToShopStyle(gender: string): string {
    const map: Record<string, string> = {
      female: 'Women',
      male: 'Men',
      unisex: 'Unisex',
    };
    return map[gender] || 'Women';
  }

  /**
   * Map color name to ASOS color ID
   * ASOS uses numeric IDs for colors
   */
  private mapColorToAsosId(color: string): string | null {
    const colorLower = color.toLowerCase();

    const map: Record<string, string> = {
      black: '2',
      white: '15',
      grey: '6',
      gray: '6',
      navy: '11',
      blue: '3',
      red: '12',
      pink: '13',
      purple: '14',
      green: '7',
      yellow: '16',
      orange: '17',
      brown: '4',
      beige: '18',
      cream: '19',
      gold: '20',
      silver: '21',
      multicoloured: '9',
      multicolored: '9',
    };

    return map[colorLower] || null;
  }

  /**
   * Estimate number of results a query might return
   * Used for optimization (skip sources unlikely to return results)
   */
  estimateResultCount(query: SearchQuery): 'high' | 'medium' | 'low' {
    let specificity = 0;

    // More specific = fewer results
    if (query.brands?.length) specificity += 2;
    if (query.itemType) specificity += 2;
    if (query.color?.length) specificity += 1;
    if (query.style) specificity += 1;
    if (query.minPrice || query.maxPrice) specificity += 1;

    if (specificity >= 5) return 'low';
    if (specificity >= 3) return 'medium';
    return 'high';
  }

  /**
   * Validate that a query is reasonable and not too broad/narrow
   */
  validateQuery(query: SearchQuery): { valid: boolean; reason?: string } {
    // Check for empty terms
    if (!query.terms || query.terms.trim().length === 0) {
      return { valid: false, reason: 'Search terms cannot be empty' };
    }

    // Check terms aren't too short (less than 2 chars)
    if (query.terms.trim().length < 2) {
      return { valid: false, reason: 'Search terms too short' };
    }

    // Check terms aren't too long (over 200 chars)
    if (query.terms.length > 200) {
      return { valid: false, reason: 'Search terms too long' };
    }

    // Check price range is valid
    if (query.minPrice && query.maxPrice && query.minPrice > query.maxPrice) {
      return { valid: false, reason: 'Invalid price range (min > max)' };
    }

    // Check limit is reasonable
    if (query.limit && (query.limit < 1 || query.limit > 200)) {
      return { valid: false, reason: 'Invalid limit (must be 1-200)' };
    }

    return { valid: true };
  }
}
