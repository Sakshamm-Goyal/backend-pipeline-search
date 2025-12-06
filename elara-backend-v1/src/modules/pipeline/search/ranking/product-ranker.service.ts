import { Injectable, Logger, Optional } from '@nestjs/common';
import { Product } from '../dto/product.dto';
import { SearchQuery } from '../dto/search-query.dto';
import { GeminiService } from '../../infrastructure/llm/gemini.service';
import { PersonalizationService, UserProfile } from '../../personalization/personalization.service';

/**
 * Product Ranker Service
 *
 * Ranks and scores products based on multiple signals:
 * - Text relevance (title/description match)
 * - User preferences (style, brand, price)
 * - Product quality signals (ratings, reviews)
 * - Price attractiveness (value for money)
 * - Source reliability
 * - Personalization signals (behavioral data from PersonalizationService)
 *
 * Uses a weighted scoring system, with optional LLM reranking
 * for close scores (when differences < 5 points).
 *
 * When PersonalizationService is available, uses behavioral
 * data to boost scores for preferred categories, brands, etc.
 */
@Injectable()
export class ProductRankerService {
  private readonly logger = new Logger(ProductRankerService.name);

  constructor(
    private geminiService: GeminiService,
    @Optional() private personalizationService?: PersonalizationService,
  ) {}

  /**
   * Rank products by relevance and user preferences
   */
  async rankProducts(
    products: Product[],
    query: SearchQuery,
    userContext?: any,
  ): Promise<Product[]> {
    if (products.length === 0) return [];

    const startTime = Date.now();

    // Step 0: Try personalization-based reranking first if available
    if (this.personalizationService && userContext?.userId) {
      try {
        const personalizedProducts = await this.personalizationService.rerankProducts(
          products,
          userContext.userId,
          userContext.profile as UserProfile,
          query.terms,
          userContext.occasion,
          query.minPrice || query.maxPrice
            ? { min: query.minPrice, max: query.maxPrice }
            : undefined,
        );

        const duration = Date.now() - startTime;
        this.logger.log(
          `Ranked ${personalizedProducts.length} products (personalized) in ${duration}ms`,
        );

        return personalizedProducts;
      } catch (error) {
        this.logger.warn(
          `Personalization reranking failed, falling back to ML: ${(error as Error).message}`,
        );
        // Fall through to standard ranking
      }
    }

    // Step 1: Score each product
    const scoredProducts = products.map((product) => ({
      product,
      score: this.calculateScore(product, query, userContext),
    }));

    // Step 2: Sort by score (descending)
    scoredProducts.sort((a, b) => b.score - a.score);

    // Step 3: Check if top products are too close (< 5 points difference)
    const shouldLlmRerank = this.shouldUseLlmReranking(scoredProducts);

    if (shouldLlmRerank) {
      this.logger.debug('Top products too close, using LLM reranking');

      try {
        // LLM rerank top 20 products
        const topProducts = scoredProducts.slice(0, 20).map((sp) => sp.product);
        const reranked = await this.geminiService.rerankProducts(
          topProducts,
          userContext?.profile || {},
          query.terms,
        );

        // Combine: LLM-reranked top 20 + remaining products
        const rankedProducts = reranked.map((r) => r.product);
        const remainingProducts = scoredProducts
          .slice(20)
          .map((sp) => sp.product);

        const allProducts = [...rankedProducts, ...remainingProducts];

        // Add scores
        allProducts.forEach((p, i) => {
          p.score = 100 - i; // Descending score
        });

        const duration = Date.now() - startTime;
        this.logger.log(
          `Ranked ${allProducts.length} products (with LLM) in ${duration}ms`,
        );

        return allProducts;
      } catch (error) {
        this.logger.warn(`LLM reranking failed, using ML scores: ${(error as Error).message}`);
        // Fall through to ML-only ranking
      }
    }

    // Add scores to products
    const rankedProducts = scoredProducts.map((sp) => {
      sp.product.score = Math.round(sp.score);
      return sp.product;
    });

    const duration = Date.now() - startTime;
    this.logger.log(
      `Ranked ${rankedProducts.length} products (ML only) in ${duration}ms`,
    );

    return rankedProducts;
  }

  /**
   * Calculate relevance score for a product (0-100)
   */
  private calculateScore(
    product: Product,
    query: SearchQuery,
    userContext?: any,
  ): number {
    let score = 0;

    // 1. Text Relevance (0-30 points)
    score += this.scoreTextRelevance(product, query);

    // 2. Brand Match (0-15 points)
    score += this.scoreBrandMatch(product, query, userContext);

    // 3. Price Fit (0-20 points)
    score += this.scorePriceFit(product, query, userContext);

    // 4. Quality Signals (0-15 points)
    score += this.scoreQuality(product);

    // 5. Style Match (0-10 points)
    score += this.scoreStyleMatch(product, query, userContext);

    // 6. Source Reliability (0-10 points)
    score += this.scoreSourceReliability(product);

    return Math.min(score, 100); // Cap at 100
  }

  /**
   * Score text relevance (title/description match)
   */
  private scoreTextRelevance(product: Product, query: SearchQuery): number {
    let score = 0;
    const queryTerms = query.terms.toLowerCase().split(/\s+/);
    const title = product.title.toLowerCase();
    const description = product.description?.toLowerCase() || '';

    // Check how many query terms appear in title
    const titleMatches = queryTerms.filter((term) => title.includes(term)).length;
    score += (titleMatches / queryTerms.length) * 20; // Max 20 points

    // Bonus for exact phrase match
    if (title.includes(query.terms.toLowerCase())) {
      score += 5;
    }

    // Description matches (less weight)
    const descMatches = queryTerms.filter((term) =>
      description.includes(term),
    ).length;
    score += (descMatches / queryTerms.length) * 5; // Max 5 points

    return score;
  }

  /**
   * Score brand match
   */
  private scoreBrandMatch(
    product: Product,
    query: SearchQuery,
    userContext?: any,
  ): number {
    let score = 0;

    const productBrand = product.brand?.toLowerCase();
    if (!productBrand) return 0;

    // Query specifies brand
    if (query.brands?.length) {
      const matchesBrand = query.brands.some(
        (b) => b.toLowerCase() === productBrand,
      );
      score += matchesBrand ? 15 : 0; // Full points for exact match
    } else if (userContext?.profile?.likedBrands?.length) {
      // User has liked brands
      const matchesLikedBrand = userContext.profile.likedBrands.some(
        (b: string) => b.toLowerCase() === productBrand,
      );
      score += matchesLikedBrand ? 10 : 0;

      // Penalty for disliked brands
      const matchesDislikedBrand = userContext.profile?.dislikedBrands?.some(
        (b: string) => b.toLowerCase() === productBrand,
      );
      if (matchesDislikedBrand) score -= 10;
    }

    return Math.max(score, 0);
  }

  /**
   * Score price fit (within budget, good value)
   */
  private scorePriceFit(
    product: Product,
    query: SearchQuery,
    userContext?: any,
  ): number {
    let score = 0;

    const minPrice = query.minPrice || userContext?.profile?.priceRange?.min || 0;
    const maxPrice =
      query.maxPrice || userContext?.profile?.priceRange?.max || 10000;

    // Within budget
    if (product.price >= minPrice && product.price <= maxPrice) {
      score += 15; // Within range: 15 points
    } else if (product.price < minPrice) {
      // Below budget (might be lower quality)
      score += 10;
    } else {
      // Above budget (penalty)
      const overage = (product.price - maxPrice) / maxPrice;
      score += Math.max(0, 10 - overage * 20); // Decrease with overage
    }

    // Bonus for good deals (on sale)
    if (product.onSale && product.discount) {
      score += Math.min(product.discount / 10, 5); // Up to 5 bonus points
    }

    return score;
  }

  /**
   * Score product quality signals
   */
  private scoreQuality(product: Product): number {
    let score = 0;

    // Rating (0-5 stars → 0-10 points)
    if (product.rating) {
      score += (product.rating / 5) * 10;
    }

    // Review count (more reviews = more reliable)
    if (product.reviewCount) {
      if (product.reviewCount >= 100) score += 5;
      else if (product.reviewCount >= 50) score += 3;
      else if (product.reviewCount >= 10) score += 1;
    }

    return score;
  }

  /**
   * Score style match
   */
  private scoreStyleMatch(
    product: Product,
    query: SearchQuery,
    userContext?: any,
  ): number {
    let score = 0;

    // Query specifies style
    if (query.style) {
      const styleLower = query.style.toLowerCase();
      const title = product.title.toLowerCase();
      const tags = product.tags?.map((t) => t.toLowerCase()) || [];

      if (title.includes(styleLower) || tags.includes(styleLower)) {
        score += 5;
      }
    }

    // User profile styles
    if (userContext?.profile?.selectedStyles?.length) {
      const userStyles = userContext.profile.selectedStyles.map((s: string) =>
        s.toLowerCase(),
      );
      const title = product.title.toLowerCase();
      const tags = product.tags?.map((t) => t.toLowerCase()) || [];

      const matchesUserStyle = userStyles.some(
        (style: string) => title.includes(style) || tags.includes(style),
      );

      if (matchesUserStyle) score += 5;
    }

    return score;
  }

  /**
   * MVP Priority Retailers (as of 2024)
   * These retailers are prioritized in search results for MVP launch
   */
  private readonly MVP_PRIORITY_RETAILERS = [
    'amazon',
    'walmart',
    'h&m', 'hm',
    'zara',
    'asos',
    'macys', "macy's",
    'nike',
    'dsw',
    'shein',
    'gap',
    'target',
  ];

  /**
   * Score source reliability
   * ENHANCED: Also considers retailer quality for better ranking
   * ENHANCED: MVP priority retailers get highest boost
   */
  private scoreSourceReliability(product: Product): number {
    // Prioritize certain sources
    const sourceScores: Record<string, number> = {
      shopstyle: 10, // Verified API data
      oxylabs: 8, // Google Shopping data
      asos_scraper: 6, // Well-known retailer
      zara_scraper: 6,
      hm_scraper: 6,
      cache: 5, // Cached (might be stale)
    };

    let score = sourceScores[product.source] || 5;

    // ENHANCED: Boost score for preferred retailers
    const retailerLower = (product.retailer || '').toLowerCase();
    const urlLower = (product.productUrl || '').toLowerCase();
    const brandLower = (product.brand || '').toLowerCase();

    // MVP PRIORITY: Highest boost for MVP retailers (Amazon, Walmart, H&M, Zara, ASOS, Macy's, Nike, DSW, Shein, Gap, Target)
    const isMvpRetailer = this.MVP_PRIORITY_RETAILERS.some(mvp =>
      retailerLower.includes(mvp) || urlLower.includes(mvp) || brandLower.includes(mvp)
    );

    if (isMvpRetailer) {
      score += 8; // Highest boost for MVP retailers
      return score;
    }

    // Top-tier retailers (official brand sites, major department stores)
    const PREMIUM_RETAILERS = [
      'nordstrom', 'bloomingdales', 'saks', 'neiman marcus',
      'bergdorf', 'net-a-porter', 'farfetch', 'ssense',
      'mrporter', 'matches fashion', 'selfridges', 'harrods',
    ];

    // Official brand sites (highest trust)
    const OFFICIAL_BRAND_PATTERNS = [
      'zara.com', 'hm.com', 'uniqlo.com', 'nike.com', 'adidas.com',
      'gap.com', 'oldnavy.com', 'bananarepublic.com', 'jcrew.com',
      'levi.com', 'ralphlauren.com', 'calvinklein.com', 'tommy.com',
      'coach.com', 'michaelkors.com', 'katespade.com', 'theory.com',
      'allensollly.com', 'allensolly.com', // Allen Solly official
    ];

    // Good mid-tier retailers
    const GOOD_RETAILERS = [
      'zappos', 'revolve', 'shopbop', 'kohls',
      'jcpenney', 'dillards', 'belk', 'anthropologie', 'urban outfitters',
      'free people', 'reformation', 'everlane', 'madewell',
    ];

    // Check for official brand site (highest boost)
    if (OFFICIAL_BRAND_PATTERNS.some(pattern => urlLower.includes(pattern))) {
      score += 5; // Significant boost for official sites
    }
    // Check for premium retailers
    else if (PREMIUM_RETAILERS.some(r => retailerLower.includes(r) || urlLower.includes(r))) {
      score += 3;
    }
    // Check for good retailers
    else if (GOOD_RETAILERS.some(r => retailerLower.includes(r) || urlLower.includes(r))) {
      score += 2;
    }

    return score;
  }

  /**
   * Check if top products are too close for ML ranking
   * Use LLM if top 5 products have < 5 point difference
   */
  private shouldUseLlmReranking(
    scoredProducts: Array<{ product: Product; score: number }>,
  ): boolean {
    if (scoredProducts.length < 5) return false;

    const top5 = scoredProducts.slice(0, 5);
    const scores = top5.map((sp) => sp.score);

    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);

    const difference = maxScore - minScore;

    return difference < 5; // Close scores → use LLM
  }

  /**
   * Deduplicate products (remove duplicates across sources)
   */
  deduplicateProducts(products: Product[]): Product[] {
    const seen = new Set<string>();
    const deduplicated: Product[] = [];

    for (const product of products) {
      // Create dedup key from title + price + retailer
      const key = this.createDeduplicationKey(product);

      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(product);
      } else {
        this.logger.debug(`Removed duplicate: ${product.title}`);
      }
    }

    this.logger.log(
      `Deduplicated ${products.length} → ${deduplicated.length} products`,
    );

    return deduplicated;
  }

  /**
   * Create deduplication key
   */
  private createDeduplicationKey(product: Product): string {
    const title = product.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const price = Math.round(product.price);
    const retailer = product.retailer.toLowerCase().replace(/[^a-z0-9]/g, '');

    return `${title}-${price}-${retailer}`;
  }

  /**
   * Filter products by availability and quality
   */
  filterProducts(products: Product[]): Product[] {
    return products.filter((product) => {
      // Must be in stock
      if (!product.inStock) return false;

      // Must have valid price
      if (!product.price || product.price <= 0) return false;

      // Must have title
      if (!product.title || product.title.length < 3) return false;

      // Must have image
      if (!product.imageUrl) return false;

      // Must have product URL
      if (!product.productUrl) return false;

      return true;
    });
  }

  /**
   * Filter products by gender (STRICT enforcement like Python version)
   * Rejects products that clearly belong to wrong gender
   *
   * FIX: Uses word boundary matching to prevent "men" from matching inside "women"
   */
  filterByGender(products: Product[], gender?: string): Product[] {
    if (!gender || gender.toLowerCase() === 'unisex') {
      return products;
    }

    // Use word boundary patterns to prevent "men" matching "women"
    // Order matters: check longer/more specific patterns first
    const MALE_PATTERNS = [/\bmen's\b/i, /\bmens\b/i, /\bmale\b/i, /\bboys?\b/i, /\bman\b/i, /\bmen\b/i];
    const FEMALE_PATTERNS = [/\bwomen's\b/i, /\bwomens\b/i, /\bwomen\b/i, /\bwoman\b/i, /\bfemale\b/i, /\bgirls?\b/i, /\bladies\b/i];

    const filtered = products.filter((product) => {
      const title = (product.title || '').toLowerCase();
      const url = (product.productUrl || '').toLowerCase();
      const combinedText = `${title} ${url}`;

      // Helper to check if any pattern matches
      const matchesPatterns = (patterns: RegExp[], text: string): boolean => {
        return patterns.some((pattern) => pattern.test(text));
      };

      if (gender.toLowerCase() === 'men' || gender.toLowerCase() === 'male') {
        // Reject if explicitly women's and NOT also men's
        const hasFemale = matchesPatterns(FEMALE_PATTERNS, combinedText);
        const hasMale = matchesPatterns(MALE_PATTERNS, combinedText);

        // If product has female keyword but no explicit male keyword (word boundary), reject
        if (hasFemale && !hasMale) {
          return false; // Reject women's products
        }
      } else if (gender.toLowerCase() === 'women' || gender.toLowerCase() === 'female') {
        // Reject if explicitly men's and NOT also women's
        const hasMale = matchesPatterns(MALE_PATTERNS, combinedText);
        const hasFemale = matchesPatterns(FEMALE_PATTERNS, combinedText);

        // If product has male keyword but no female keyword, reject
        if (hasMale && !hasFemale) {
          return false; // Reject men's products
        }
      }

      return true;
    });

    if (filtered.length < products.length) {
      this.logger.debug(
        `Gender filter (${gender}): ${products.length} → ${filtered.length} products`,
      );
    }

    return filtered;
  }

  /**
   * Filter products by price (BEFORE ranking, not after)
   * Matches Python version behavior
   */
  filterByPrice(products: Product[], maxPrice?: number, minPrice?: number): Product[] {
    if (!maxPrice && !minPrice) {
      return products;
    }

    const filtered = products.filter((product) => {
      if (!product.price || product.price <= 0) {
        return true; // Keep products without price info
      }

      if (maxPrice && product.price > maxPrice) {
        return false;
      }

      if (minPrice && product.price < minPrice) {
        return false;
      }

      return true;
    });

    if (filtered.length < products.length) {
      this.logger.debug(
        `Price filter ($${minPrice || 0}-$${maxPrice || '∞'}): ${products.length} → ${filtered.length} products`,
      );
    }

    return filtered;
  }

  /**
   * Filter out category/listing page URLs (not actual product pages)
   * Matches Python version behavior
   * ENHANCED: Also filters out fabricated/placeholder URLs from AI-generated sources
   */
  filterByUrlType(products: Product[]): Product[] {
    const CATEGORY_PATTERNS = [
      '/category/',
      '/categories/',
      '/collection/',
      '/collections/',
      '/search?',
      '/search/',
      '/shop/',
      '/browse/',
      '/listing/',
      '/products?',
      '/c/',
      '/s/',
    ];

    // Detect fabricated/placeholder URLs from AI-generated sources (claude_web)
    // Claude Web Search doesn't actually browse the web - it generates fictional URLs
    // ALL URLs from claude_web source are fabricated and should be filtered out
    const isFabricatedUrl = (url: string, source: string): boolean => {
      // AGGRESSIVE FILTER: ALL claude_web products have fabricated URLs
      // The Claude Web Search service doesn't actually browse - it hallucinates product data
      if (source === 'claude_web') {
        return true; // All claude_web URLs are fake
      }

      return false;
    };

    const filtered = products.filter((product) => {
      const url = (product.productUrl || '').toLowerCase();

      // Reject if URL matches category patterns
      const isCategory = CATEGORY_PATTERNS.some((pattern) => url.includes(pattern));

      if (isCategory) {
        this.logger.debug(`Filtered out category URL: ${url}`);
        return false;
      }

      // Reject fabricated URLs (from AI sources that hallucinate URLs)
      if (isFabricatedUrl(url, product.source)) {
        this.logger.debug(`Filtered out fabricated URL from ${product.source}: ${url}`);
        return false;
      }

      return true;
    });

    if (filtered.length < products.length) {
      this.logger.debug(
        `URL type filter: ${products.length} → ${filtered.length} products`,
      );
    }

    return filtered;
  }

  /**
   * Apply all filters in the correct order (matches Python pipeline)
   * Order: ItemType → Brand → Retailer → Gender → Color → Price → URL Type → Quality/Availability → Dedup
   * ENHANCED: Added color filtering (ported from Python)
   * ENHANCED: Added itemType filtering to ensure slot-appropriate products
   * ENHANCED: Added STRICT brand filtering when user specifies brands
   * ENHANCED: Added retailer quality filter (blocks eBay, prefers official sites)
   */
  applyAllFilters(
    products: Product[],
    query: SearchQuery,
  ): Product[] {
    let filtered = products;

    // Step 0: Item type filter (CRITICAL for outfit slots - ensures shoes slot gets shoes, not dresses)
    filtered = this.filterByItemType(filtered, query.itemType);

    // Step 0.5: Brand filter (STRICT - when user asks for Zara, ONLY show Zara)
    filtered = this.filterByBrand(filtered, query.brands);

    // Step 0.6: Retailer quality filter (block eBay, prefer official sites and Amazon)
    filtered = this.filterByRetailerQuality(filtered);

    // Step 1: Gender filter (STRICT)
    filtered = this.filterByGender(filtered, query.gender);

    // Step 2: Color filter (PRIORITIZE matching colors)
    filtered = this.filterAndBoostByColor(filtered, query.color);

    // Step 3: Price filter (BEFORE ranking)
    filtered = this.filterByPrice(filtered, query.maxPrice, query.minPrice);

    // Step 4: URL type filter
    filtered = this.filterByUrlType(filtered);

    // Step 5: Quality/availability filter
    filtered = this.filterProducts(filtered);

    // Step 6: Deduplicate
    filtered = this.deduplicateProducts(filtered);

    this.logger.log(
      `Applied all filters: ${products.length} → ${filtered.length} products`,
    );

    return filtered;
  }

  /**
   * Filter products by retailer quality
   * BLOCKS: eBay, Alibaba, AliExpress, Wish, Temu (reseller/low-quality marketplaces)
   * PREFERS: Official brand sites, Amazon, Nordstrom, ASOS, Macy's, etc.
   *
   * This ensures users get products from trusted retailers with:
   * - Authentic products (not counterfeits)
   * - Good return policies
   * - Reliable shipping
   * - Customer support
   *
   * NOTE: Shein is ALLOWED as it's part of MVP priority retailers
   */
  filterByRetailerQuality(products: Product[]): Product[] {
    // Blocked retailers (reseller marketplaces, counterfeit risks)
    // NOTE: Shein removed - it's an MVP priority retailer
    const BLOCKED_RETAILERS = [
      'ebay',
      'alibaba',
      'aliexpress',
      'wish',
      'temu',
      'dhgate',
      'banggood',
      'gearbest',
      'lightinthebox',
      'sammydress',
      'rosegal',
      'zaful', // Not the real Zara
      'romwe',
    ];

    // Check both retailer name and URL
    const isBlockedRetailer = (product: Product): boolean => {
      const retailerLower = (product.retailer || '').toLowerCase();
      const urlLower = (product.productUrl || '').toLowerCase();

      return BLOCKED_RETAILERS.some(blocked =>
        retailerLower.includes(blocked) || urlLower.includes(blocked)
      );
    };

    const filtered = products.filter((product) => {
      if (isBlockedRetailer(product)) {
        this.logger.debug(
          `[Retailer Filter] Blocking product from "${product.retailer}": ${product.title?.substring(0, 50)}...`,
        );
        return false;
      }
      return true;
    });

    if (filtered.length < products.length) {
      this.logger.log(
        `[Retailer Filter] ${products.length} → ${filtered.length} products (blocked ${products.length - filtered.length} from low-quality retailers)`,
      );
    }

    // If filtering removed ALL products, return original (fallback)
    // This prevents empty results if only eBay had the item
    if (filtered.length === 0 && products.length > 0) {
      this.logger.warn(
        `[Retailer Filter] All products were from blocked retailers. Returning original to avoid empty results.`,
      );
      return products;
    }

    return filtered;
  }

  /**
   * Filter products by brand (STRICT enforcement)
   * When user explicitly requests a brand (e.g., "Zara yellow shirt"),
   * ONLY show products from that brand - reject all others.
   *
   * This is different from brand preference (boost matching brands).
   * This is brand REQUIREMENT (filter out non-matching).
   */
  filterByBrand(products: Product[], brands?: string[]): Product[] {
    if (!brands || brands.length === 0) {
      return products; // No brand filter requested
    }

    // Normalize requested brands to lowercase
    const requestedBrands = brands.map(b => b.toLowerCase().trim());

    this.logger.log(`[Brand Filter] Filtering for brands: ${requestedBrands.join(', ')}`);

    const filtered = products.filter((product) => {
      const productBrand = (product.brand || '').toLowerCase().trim();
      const productTitle = (product.title || '').toLowerCase();
      const productRetailer = (product.retailer || '').toLowerCase();

      // Check if product brand matches any requested brand
      // Use includes for partial matching (e.g., "Zara" matches "Zara Home")
      const brandMatches = requestedBrands.some(requestedBrand => {
        // Exact match on brand field
        if (productBrand === requestedBrand) {
          return true;
        }

        // Partial match on brand field (e.g., "Zara" in "Zara TRF")
        if (productBrand && productBrand.includes(requestedBrand)) {
          return true;
        }

        // Check title for brand name (some products don't have brand field)
        if (productTitle.includes(requestedBrand)) {
          return true;
        }

        // Check retailer for brand name (e.g., Zara.com)
        if (productRetailer.includes(requestedBrand)) {
          return true;
        }

        return false;
      });

      if (!brandMatches) {
        this.logger.debug(
          `[Brand Filter] Rejecting product (brand: "${productBrand}"): ${product.title?.substring(0, 50)}...`,
        );
      }

      return brandMatches;
    });

    this.logger.log(
      `[Brand Filter] ${products.length} → ${filtered.length} products (requested: ${brands.join(', ')})`,
    );

    // IMPORTANT: If filtering removes ALL products, it means the search API
    // couldn't find products from that brand. Return empty to trigger "no results" UX.
    // Do NOT fallback to non-matching brands (user explicitly asked for a brand).
    if (filtered.length === 0 && products.length > 0) {
      this.logger.warn(
        `[Brand Filter] No products matched brand "${brands.join(', ')}". ` +
        `Original products had brands: ${[...new Set(products.map(p => p.brand).filter(Boolean))].join(', ')}`,
      );
    }

    return filtered;
  }

  /**
   * Filter products by item type (CRITICAL for outfit slot accuracy)
   * Ensures that each slot gets appropriate products (shoes get shoes, not dresses)
   */
  filterByItemType(products: Product[], itemType?: string): Product[] {
    if (!itemType) {
      return products;
    }

    const itemTypeLower = itemType.toLowerCase();

    // Define keywords for each item type category
    const ITEM_TYPE_KEYWORDS: Record<string, string[]> = {
      // Footwear
      'shoes': ['shoe', 'shoes', 'sneaker', 'sneakers', 'boot', 'boots', 'heel', 'heels', 'sandal', 'sandals', 'loafer', 'loafers', 'flat', 'flats', 'pump', 'pumps', 'oxford', 'oxfords', 'mule', 'mules', 'slipper', 'slippers', 'espadrille', 'espadrilles', 'wedge', 'wedges', 'stiletto', 'stilettos', 'platform', 'footwear'],
      'heels': ['heel', 'heels', 'pump', 'pumps', 'stiletto', 'stilettos', 'wedge', 'wedges', 'platform heel', 'high heel', 'kitten heel', 'block heel', 'strappy heel'],
      'sneakers': ['sneaker', 'sneakers', 'trainer', 'trainers', 'athletic shoe', 'running shoe', 'tennis shoe'],
      'boots': ['boot', 'boots', 'bootie', 'booties', 'ankle boot', 'knee boot', 'chelsea boot', 'combat boot'],
      'sandals': ['sandal', 'sandals', 'flip flop', 'flip flops', 'slide', 'slides', 'thong sandal'],

      // Watches
      'watch': ['watch', 'watches', 'timepiece', 'wristwatch', 'chronograph', 'smartwatch'],

      // Belts
      'belt': ['belt', 'belts', 'waist belt', 'leather belt', 'chain belt', 'buckle belt'],

      // Sunglasses/Eyewear
      'sunglasses': ['sunglasses', 'sunglass', 'shades', 'eyewear', 'aviator', 'wayfarer', 'cat eye sunglasses', 'round sunglasses'],
      'glasses': ['glasses', 'eyeglasses', 'spectacles', 'optical', 'reading glasses'],

      // Bags
      'bag': ['bag', 'bags', 'handbag', 'handbags', 'purse', 'purses', 'tote', 'totes', 'clutch', 'clutches', 'crossbody', 'shoulder bag', 'backpack', 'satchel'],
      'handbag': ['handbag', 'handbags', 'purse', 'purses', 'tote', 'clutch', 'crossbody', 'shoulder bag', 'satchel'],

      // Jewelry
      'jewelry': ['jewelry', 'jewellery', 'necklace', 'bracelet', 'earring', 'ring', 'pendant', 'chain', 'bangle'],
      'necklace': ['necklace', 'necklaces', 'pendant', 'chain', 'choker', 'collar necklace'],
      'bracelet': ['bracelet', 'bracelets', 'bangle', 'bangles', 'cuff', 'charm bracelet'],
      'earrings': ['earring', 'earrings', 'stud', 'studs', 'hoop', 'hoops', 'drop earring', 'dangle'],

      // Dresses (to EXCLUDE when searching for accessories)
      'dress': ['dress', 'dresses', 'gown', 'gowns', 'maxi', 'midi', 'mini dress', 'cocktail dress', 'evening dress', 'bodycon'],

      // Tops
      'top': ['top', 'tops', 'blouse', 'shirt', 'tee', 't-shirt', 'tank', 'camisole', 'sweater', 'cardigan', 'hoodie'],
      'shirt': ['shirt', 'shirts', 'blouse', 'button-down', 'oxford shirt', 'dress shirt'],

      // Pants
      'pants': ['pants', 'pant', 'trousers', 'jeans', 'slacks', 'chinos', 'leggings', 'joggers'],
      'jeans': ['jeans', 'jean', 'denim pants', 'skinny jeans', 'straight jeans', 'bootcut'],

      // Skirts
      'skirt': ['skirt', 'skirts', 'mini skirt', 'midi skirt', 'maxi skirt', 'pencil skirt', 'a-line skirt'],

      // Outerwear
      'jacket': ['jacket', 'jackets', 'blazer', 'coat', 'bomber', 'denim jacket', 'leather jacket'],
      'coat': ['coat', 'coats', 'overcoat', 'trench', 'parka', 'peacoat', 'wool coat'],
    };

    // Find matching keywords for this item type
    let keywords: string[] = [];

    // Check if itemType directly matches a category
    for (const [category, categoryKeywords] of Object.entries(ITEM_TYPE_KEYWORDS)) {
      if (itemTypeLower.includes(category) || categoryKeywords.some(kw => itemTypeLower.includes(kw))) {
        keywords = categoryKeywords;
        break;
      }
    }

    // If no keywords found, extract keywords from the itemType itself
    if (keywords.length === 0) {
      keywords = itemTypeLower.split(/\s+/).filter(w => w.length > 2);
    }

    if (keywords.length === 0) {
      return products;
    }

    // Determine if this is an accessory slot (NOT clothing)
    const isAccessorySlot = ['watch', 'belt', 'sunglasses', 'bag', 'jewelry', 'necklace', 'bracelet', 'earrings'].some(
      acc => itemTypeLower.includes(acc)
    );
    const isFootwearSlot = ['shoe', 'heel', 'sneaker', 'boot', 'sandal', 'flat', 'pump', 'loafer'].some(
      fw => itemTypeLower.includes(fw)
    );

    // Keywords that indicate clothing (to EXCLUDE from accessory/footwear slots)
    const CLOTHING_KEYWORDS = ['dress', 'dresses', 'gown', 'top', 'blouse', 'shirt', 'pants', 'jeans', 'skirt', 'jacket', 'coat', 'sweater', 'cardigan', 'bodycon', 'midi', 'maxi', 'mini dress', 'romper', 'jumpsuit'];

    const filtered = products.filter((product) => {
      const title = (product.title || '').toLowerCase();
      const category = (product.category || '').toLowerCase();
      const combined = ` ${title} ${category} `; // Add spaces for word boundary matching

      // Helper function to check for whole word match (avoid "flattering" matching "flat")
      const containsWholeWord = (text: string, word: string): boolean => {
        // Match word with word boundaries (space, start, end, punctuation)
        const pattern = new RegExp(`(?:^|\\s|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s|[^a-z])`, 'i');
        return pattern.test(text);
      };

      // Check if product matches the item type keywords (with word boundary check for short words)
      const matchesItemType = keywords.some(kw => {
        // For short keywords (< 5 chars), require whole word match to avoid false positives
        // e.g., "flat" shouldn't match "flattering", "heel" shouldn't match "wheelchair"
        if (kw.length < 5) {
          return containsWholeWord(combined, kw);
        }
        return combined.includes(kw);
      });

      // For accessory/footwear slots, EXCLUDE clothing items (use whole word match)
      if (isAccessorySlot || isFootwearSlot) {
        const isClothing = CLOTHING_KEYWORDS.some(kw => {
          if (kw.length < 5) {
            return containsWholeWord(combined, kw);
          }
          return combined.includes(kw);
        });

        // STRICT: For accessory/footwear slots, if product contains dress/gown, EXCLUDE IT
        // This takes priority over keyword matching
        if (isClothing) {
          this.logger.debug(`Excluding clothing item from ${itemType} slot: ${title.substring(0, 50)}...`);
          return false;
        }
      }

      return matchesItemType;
    });

    this.logger.log(
      `Item type filter (${itemType}): ${products.length} → ${filtered.length} products`,
    );

    // CRITICAL FIX: For accessory/footwear slots, do NOT fallback to clothing products
    // If we're searching for watches and only get dresses, return EMPTY rather than dresses
    if (filtered.length === 0 && products.length > 0) {
      // Check if this is an accessory/footwear slot that should NOT fallback to clothing
      const isAccessorySlot = ['watch', 'belt', 'sunglasses', 'bag', 'jewelry', 'necklace', 'bracelet', 'earrings'].some(
        acc => itemTypeLower.includes(acc)
      );
      const isFootwearSlot = ['shoe', 'heel', 'sneaker', 'boot', 'sandal', 'flat', 'pump', 'loafer'].some(
        fw => itemTypeLower.includes(fw)
      );

      if (isAccessorySlot || isFootwearSlot) {
        // For accessories/footwear: TRUST the search results if the search term was specific
        // The search query itself already has correct terms (e.g., "women sunglasses", "belt")
        // If nothing matched our keywords, the search API probably returned what it could find
        // Better to show some products than none for outfit completion

        // Only filter out clothing items (dresses, tops, etc.) - never show those in accessory slots
        const clothingFiltered = products.filter(product => {
          const title = (product.title || '').toLowerCase();
          const category = (product.category || '').toLowerCase();
          const combined = ` ${title} ${category} `;

          // Check for clothing keywords that should NEVER appear in accessory slots
          const STRICT_CLOTHING = ['dress', 'dresses', 'gown', 'top', 'blouse', 'shirt', 'pants', 'jeans', 'skirt', 'jumpsuit', 'romper', 'bodycon'];
          const isClothing = STRICT_CLOTHING.some(kw => combined.includes(kw));

          return !isClothing; // Keep non-clothing items
        });

        if (clothingFiltered.length > 0) {
          this.logger.log(`Item type filter for "${itemType}" (accessory/footwear slot): ${products.length} → ${clothingFiltered.length} after removing clothing`);
          return clothingFiltered;
        }

        // If ALL products are clothing, return empty (can't use dresses as accessories)
        this.logger.warn(`Item type filter removed all products for "${itemType}" (accessory/footwear slot), returning EMPTY to prevent wrong product types`);
        return [];
      }

      // For clothing items, fallback is acceptable (e.g., searching for "blue dress" returns dresses)
      this.logger.warn(`Item type filter removed all products for "${itemType}", returning unfiltered`);
      return products;
    }

    return filtered;
  }

  /**
   * Filter and boost products by color (PORTED FROM PYTHON)
   * Products matching color are prioritized, but don't exclude non-matching if few results
   */
  filterAndBoostByColor(products: Product[], colors?: string[]): Product[] {
    if (!colors || colors.length === 0) {
      return products;
    }

    const colorLower = colors.map(c => c.toLowerCase());

    // Color synonyms for better matching
    const COLOR_SYNONYMS: Record<string, string[]> = {
      'red': ['red', 'crimson', 'maroon', 'burgundy', 'scarlet', 'cherry', 'ruby'],
      'blue': ['blue', 'navy', 'cobalt', 'azure', 'indigo', 'teal', 'sapphire', 'denim'],
      'green': ['green', 'olive', 'emerald', 'sage', 'mint', 'forest', 'lime', 'teal'],
      'pink': ['pink', 'rose', 'blush', 'coral', 'salmon', 'fuchsia', 'magenta'],
      'black': ['black', 'noir', 'onyx', 'charcoal', 'jet'],
      'white': ['white', 'ivory', 'cream', 'off-white', 'pearl', 'snow'],
      'brown': ['brown', 'tan', 'beige', 'camel', 'espresso', 'chocolate', 'cognac', 'mocha'],
      'purple': ['purple', 'violet', 'lavender', 'plum', 'mauve', 'lilac'],
      'yellow': ['yellow', 'gold', 'mustard', 'lemon', 'amber', 'honey'],
      'orange': ['orange', 'coral', 'peach', 'tangerine', 'rust'],
      'gray': ['gray', 'grey', 'silver', 'charcoal', 'slate', 'heather'],
    };

    // Build expanded color list with synonyms
    const expandedColors: string[] = [];
    for (const color of colorLower) {
      expandedColors.push(color);
      // Add synonyms
      for (const [baseColor, synonyms] of Object.entries(COLOR_SYNONYMS)) {
        if (color === baseColor || synonyms.includes(color)) {
          expandedColors.push(...synonyms);
        }
      }
    }
    const uniqueColors = [...new Set(expandedColors)];

    // Separate products into matching and non-matching
    const matching: Product[] = [];
    const nonMatching: Product[] = [];

    for (const product of products) {
      const title = (product.title || '').toLowerCase();
      const productColor = (product.color || '').toLowerCase();
      const combined = `${title} ${productColor}`;

      const matchesColor = uniqueColors.some(c => combined.includes(c));

      if (matchesColor) {
        matching.push(product);
      } else {
        nonMatching.push(product);
      }
    }

    // If we have enough matching products, prioritize them
    if (matching.length >= 10) {
      this.logger.log(`Color filter: ${matching.length} matching products, prioritizing them`);
      // Put matching first, then non-matching as backup
      return [...matching, ...nonMatching];
    }

    // If few matching products, include non-matching but with lower priority
    if (matching.length > 0) {
      this.logger.log(`Color filter: Only ${matching.length} matching products, including non-matching as backup`);
      return [...matching, ...nonMatching];
    }

    // No matching products - return all (don't exclude everything)
    this.logger.warn(`Color filter: No products match colors ${colors.join(', ')}, returning all`);
    return products;
  }

  /**
   * Apply diversity to results (don't show too many from same brand/retailer)
   */
  diversifyResults(products: Product[], maxPerBrand: number = 5): Product[] {
    const brandCounts = new Map<string, number>();
    const retailerCounts = new Map<string, number>();
    const diversified: Product[] = [];

    for (const product of products) {
      const brand = product.brand?.toLowerCase() || 'unknown';
      const retailer = product.retailer.toLowerCase();

      const brandCount = brandCounts.get(brand) || 0;
      const retailerCount = retailerCounts.get(retailer) || 0;

      // Skip if we already have too many from this brand/retailer
      if (brandCount >= maxPerBrand || retailerCount >= maxPerBrand * 2) {
        continue;
      }

      diversified.push(product);
      brandCounts.set(brand, brandCount + 1);
      retailerCounts.set(retailer, retailerCount + 1);
    }

    if (diversified.length < products.length) {
      this.logger.debug(
        `Diversified ${products.length} → ${diversified.length} products`,
      );
    }

    return diversified;
  }
}
