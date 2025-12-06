import { Injectable, Logger } from '@nestjs/common';
import { ContextService } from './context.service';
import { SearchOrchestratorService } from '../../search/search-orchestrator.service';
import { ProductRankerService } from '../../search/ranking/product-ranker.service';
import { buildSearchQuery, SearchFilters, SearchQuery } from '../../search/dto/search-query.dto';
import { Product } from '../../search/dto/product.dto';
import {
  ContextPack,
  ContextFilters,
  StyleConstraints,
  WeatherContext,
  FashionTrend,
} from '../dto/context-pack.dto';
import { ColorPairingService, ColorPairingResult } from '../../utilities/color-pairing.service';

/**
 * Context-Aware Search Service
 *
 * Enhances product searches with full context awareness including:
 * - Weather conditions and material preferences
 * - Event/occasion appropriateness
 * - User style preferences and color choices
 * - Current fashion trends
 * - Budget constraints
 *
 * Can be used by any handler that needs context-aware product search.
 */

export interface ContextSearchRequest {
  userId: string;
  query: string;
  filters?: Partial<ContextFilters>;
  limit?: number;
  boostTrending?: boolean;
  respectConstraints?: boolean;
}

export interface ContextSearchResult {
  products: Product[];
  totalFound: number;
  context: {
    weather?: WeatherContext;
    constraints: StyleConstraints;
    appliedTrends: FashionTrend[];
    enhancedQuery: string;
    colorPairing?: ColorPairingResult;  // Added for "goes with X color" queries
  };
  sources: string[];
  timing: {
    contextPrep: number;
    search: number;
    ranking: number;
    total: number;
  };
}

@Injectable()
export class ContextAwareSearchService {
  private readonly logger = new Logger(ContextAwareSearchService.name);

  constructor(
    private contextService: ContextService,
    private searchOrchestrator: SearchOrchestratorService,
    private productRanker: ProductRankerService,
    private colorPairingService: ColorPairingService,
  ) {}

  /**
   * Execute a context-aware search
   */
  async search(request: ContextSearchRequest): Promise<ContextSearchResult> {
    const startTime = Date.now();
    let contextPrepTime = 0;
    let searchTime = 0;
    let rankingTime = 0;

    this.logger.debug(`Context-aware search for user ${request.userId}: "${request.query}"`);

    // Step 0: Detect if this is a color pairing query (e.g., "goes with olive skirt")
    const colorPairingIntent = this.colorPairingService.detectColorPairingIntent(request.query);
    let colorPairingResult: ColorPairingResult | undefined;
    let transformedQuery = request.query;

    if (colorPairingIntent.isPairingQuery && colorPairingIntent.existingColor) {
      this.logger.log(
        `COLOR PAIRING DETECTED: User asking what goes with "${colorPairingIntent.existingColor}" ${colorPairingIntent.itemType || 'item'}`,
      );

      // Get complementary colors instead of matching colors
      colorPairingResult = this.colorPairingService.getColorPairings({
        existingColor: colorPairingIntent.existingColor,
        itemType: colorPairingIntent.itemType,
        occasion: request.filters?.occasion,
        style: request.filters?.style,
      });

      // Transform the search to use complementary colors
      const transformed = this.colorPairingService.transformSearchTermsForPairing(
        request.query,
        colorPairingIntent.existingColor,
        colorPairingIntent.itemType,
      );

      // Update query to search for complementary items, NOT matching colors
      transformedQuery = transformed.terms;

      this.logger.log(
        `COLOR PAIRING TRANSFORM: Original query "${request.query}" -> ` +
        `Searching for "${transformedQuery}" in complementary colors: [${transformed.colors.join(', ')}]`,
      );

      // Update filters to use complementary colors
      if (!request.filters) {
        request.filters = {};
      }
      // Set the color filter to complementary colors (will be used in search)
      (request.filters as any).color = transformed.colors; // All complementary colors
    }

    // Step 1: Prepare context
    const contextStart = Date.now();
    const contextPack = await this.contextService.prepare(request.userId, {
      occasion: request.filters?.occasion,
      location: request.filters?.location,
      datetime: request.filters?.datetime || new Date(),
      color: request.filters?.color,
      style: request.filters?.style,
      priceRange: request.filters?.priceRange,
      brands: request.filters?.brands,
      excludeBrands: request.filters?.excludeBrands,
    });
    contextPrepTime = Date.now() - contextStart;

    this.logger.debug(`Context prepared: ${this.contextService.summarize(contextPack)}`);

    // Step 2: Enhance query with context (use transformed query if color pairing detected)
    const enhancedQuery = this.enhanceQueryWithContext(
      transformedQuery,
      contextPack,
      request.boostTrending ?? true,
    );

    // Step 3: Build search query with context-aware filters
    const searchFilters = this.buildContextFilters(request.filters, contextPack);

    // If color pairing detected, add complementary colors to filter
    if (colorPairingResult) {
      searchFilters.color = colorPairingResult.complementaryColors.slice(0, 3);
      this.logger.debug(`Setting color filter to complementary colors: ${searchFilters.color}`);
    }

    const searchQuery = buildSearchQuery(
      enhancedQuery,
      searchFilters,
      {
        userId: request.userId,
        profile: contextPack.userProfile,
      },
    );
    searchQuery.limit = request.limit || 30;

    // Step 4: Execute search
    const searchStart = Date.now();
    const searchResult = await this.searchOrchestrator.search(searchQuery, {
      userId: request.userId,
      profile: contextPack.userProfile,
    });
    searchTime = Date.now() - searchStart;

    // Step 5: Filter products by constraints (if enabled)
    let filteredProducts = searchResult.products;
    if (request.respectConstraints ?? true) {
      filteredProducts = this.filterByConstraints(searchResult.products, contextPack.constraints);
    }

    // Step 6: Rank products with context
    const rankingStart = Date.now();
    const rankedProducts = await this.rankWithContext(
      filteredProducts,
      searchQuery,
      contextPack,
    );
    rankingTime = Date.now() - rankingStart;

    const totalTime = Date.now() - startTime;

    this.logger.log(
      `Context search complete: ${rankedProducts.length} products in ${totalTime}ms ` +
      `(context: ${contextPrepTime}ms, search: ${searchTime}ms, ranking: ${rankingTime}ms)`,
    );

    return {
      products: rankedProducts,
      totalFound: searchResult.totalFound,
      context: {
        weather: contextPack.weather,
        constraints: contextPack.constraints,
        appliedTrends: contextPack.trends.slice(0, 5),
        enhancedQuery,
        colorPairing: colorPairingResult,  // Include color pairing info if detected
      },
      sources: searchResult.sources,
      timing: {
        contextPrep: contextPrepTime,
        search: searchTime,
        ranking: rankingTime,
        total: totalTime,
      },
    };
  }

  /**
   * Enhance query with contextual information
   */
  private enhanceQueryWithContext(
    query: string,
    context: ContextPack,
    boostTrending: boolean,
  ): string {
    const parts = [query];

    // Add weather-appropriate terms
    if (context.weather) {
      const weatherTerms = this.getWeatherSearchTerms(context.constraints.temperatureRange);
      if (weatherTerms) {
        parts.push(weatherTerms);
      }
    }

    // Add occasion/formality terms
    if (context.eventContext?.formality) {
      const formalityTerms = this.getFormalitySearchTerms(context.eventContext.formality);
      if (formalityTerms) {
        parts.push(formalityTerms);
      }
    }

    // Add trending style if relevant
    if (boostTrending && context.trends.length > 0) {
      const topStyleTrend = context.trends.find(t => t.category === 'style' && t.relevanceScore > 0.85);
      if (topStyleTrend) {
        parts.push(topStyleTrend.name.toLowerCase());
      }
    }

    return parts.join(' ');
  }

  /**
   * Get weather-appropriate search terms
   */
  private getWeatherSearchTerms(temperatureRange: string): string | null {
    const terms: Record<string, string> = {
      cold: 'warm cozy winter',
      cool: 'layering fall',
      mild: '',
      warm: 'lightweight breathable',
      hot: 'light cool summer',
    };
    return terms[temperatureRange] || null;
  }

  /**
   * Get formality-appropriate search terms
   */
  private getFormalitySearchTerms(formality: string): string | null {
    const terms: Record<string, string> = {
      casual: 'casual relaxed comfortable',
      smart_casual: 'polished smart',
      business_casual: 'professional office',
      business: 'formal professional',
      formal: 'elegant dressy',
      black_tie: 'formal evening gala',
    };
    return terms[formality] || null;
  }

  /**
   * Build search filters from context
   */
  private buildContextFilters(
    requestFilters: Partial<ContextFilters> | undefined,
    context: ContextPack,
  ): SearchFilters {
    const filters: SearchFilters = {};

    // Apply request filters
    if (requestFilters?.occasion) filters.occasion = requestFilters.occasion;
    if (requestFilters?.itemType) filters.itemType = requestFilters.itemType;
    if (requestFilters?.color) filters.color = requestFilters.color;
    if (requestFilters?.style) filters.style = requestFilters.style;

    // Apply brands from request or user preferences
    const brands = requestFilters?.brands || context.userProfile.brandPreferences.likedBrands;
    if (brands && brands.length > 0) {
      filters.brand = brands;
    }

    // Apply price range from request or user preferences
    const priceRange = requestFilters?.priceRange || context.userProfile.brandPreferences.priceRange;
    if (priceRange) {
      filters.priceRange = priceRange;
    }

    // Apply gender from user profile
    if (context.userProfile.gender !== 'unisex') {
      filters.gender = context.userProfile.gender;
    }

    return filters;
  }

  /**
   * Filter products by style constraints
   */
  private filterByConstraints(products: Product[], constraints: StyleConstraints): Product[] {
    return products.filter(product => {
      // Check material constraints
      const productMaterial = ((product as any).material || '').toLowerCase();

      // Skip products with avoided materials
      for (const avoidMaterial of constraints.avoidMaterials) {
        if (productMaterial.includes(avoidMaterial.toLowerCase())) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Rank products with context awareness
   */
  private async rankWithContext(
    products: Product[],
    query: SearchQuery,
    context: ContextPack,
  ): Promise<Product[]> {
    // First, apply base ranking
    const baseRanked = await this.productRanker.rankProducts(
      products,
      query,
      context.userProfile,
    );

    // Then apply context-based boosts
    const contextRanked = baseRanked.map(product => {
      let boost = 0;

      // Boost products matching preferred materials
      const productMaterial = ((product as any).material || '').toLowerCase();
      for (const preferredMaterial of context.constraints.preferredMaterials) {
        if (productMaterial.includes(preferredMaterial.toLowerCase())) {
          boost += 0.1;
          break;
        }
      }

      // Boost products matching preferred colors
      const productColor = ((product as any).color || product.title || '').toLowerCase();
      for (const preferredColor of context.userProfile.stylePreferences.colorPreferences) {
        if (productColor.includes(preferredColor.toLowerCase())) {
          boost += 0.05;
          break;
        }
      }

      // Penalize products with avoided colors
      for (const avoidColor of context.userProfile.stylePreferences.avoidColors) {
        if (productColor.includes(avoidColor.toLowerCase())) {
          boost -= 0.15;
          break;
        }
      }

      // Boost trending colors
      const colorTrends = context.trends.filter(t => t.category === 'color');
      for (const trend of colorTrends) {
        if (productColor.includes(trend.name.toLowerCase())) {
          boost += trend.relevanceScore * 0.1;
          break;
        }
      }

      // Apply boost to existing score
      const currentScore = (product as any).relevanceScore || 0.5;
      (product as any).contextBoost = boost;
      (product as any).finalScore = Math.min(1, Math.max(0, currentScore + boost));

      return product;
    });

    // Re-sort by final score
    contextRanked.sort((a, b) => {
      const scoreA = (a as any).finalScore || 0;
      const scoreB = (b as any).finalScore || 0;
      return scoreB - scoreA;
    });

    return contextRanked;
  }

  /**
   * Get a quick context summary for a search
   */
  async getContextSummary(userId: string, location?: string): Promise<{
    weather?: { temperature: number; condition: string };
    style: string;
    trends: string[];
  }> {
    const context = await this.contextService.prepare(userId, { location });

    return {
      weather: context.weather ? {
        temperature: context.weather.temperature,
        condition: context.weather.condition,
      } : undefined,
      style: context.userProfile.stylePreferences.primaryStyle,
      trends: context.trends.slice(0, 3).map(t => t.name),
    };
  }
}
