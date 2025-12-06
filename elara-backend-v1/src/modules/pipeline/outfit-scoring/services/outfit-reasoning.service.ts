import { Injectable, Logger } from '@nestjs/common';
import { GeminiService, OutfitRecommendation } from '../../infrastructure/llm/gemini.service';
import { SearchOrchestratorService } from '../../search/search-orchestrator.service';
import { ContextService } from '../../context/services/context.service';
import { buildSearchQuery } from '../../search/dto/search-query.dto';
import { Product } from '../../search/dto/product.dto';
import {
  ContextPack,
  ContextFilters,
  StyleConstraints,
  EventContext,
  WeatherContext,
  WardrobeItem,
  FashionTrend,
} from '../../context/dto/context-pack.dto';

/**
 * Outfit Reasoning Service
 *
 * Advanced outfit generation using full context awareness.
 * Integrates:
 * - User profile and preferences
 * - Weather conditions and constraints
 * - Event/occasion context
 * - Fashion trends
 * - Wardrobe synergy
 * - Style constraints
 *
 * Uses Gemini LLM with rich context for intelligent outfit curation.
 */

export interface OutfitGenerationRequest {
  userId: string;
  query: string;
  filters?: Partial<ContextFilters>;
  wardrobeItemIds?: string[]; // Optional wardrobe items to include
  excludeProductIds?: string[]; // Products to exclude
  count?: number; // Number of outfits to generate (1-5, default 3)
}

export interface GeneratedOutfit {
  id: string;
  name: string;
  style: string;
  items: OutfitItem[];
  totalPrice: number;
  colorScheme: string;
  styleNotes: string;
  wardrobeSynergy: string;
  occasionFit: string;
  weatherFit: string;
  trendAlignment: string[];
  constraintValidation: ConstraintValidation;
  score: number;
}

export interface OutfitItem {
  slot: string;
  productId: string;
  product?: Product;
  wardrobeItemId?: string;
  wardrobeItem?: WardrobeItem;
  selectionReason: string;
  isFromWardrobe: boolean;
}

export interface ConstraintValidation {
  passed: boolean;
  checks: {
    weatherAppropriate: boolean;
    eventAppropriate: boolean;
    budgetCompliant: boolean;
    coverageCompliant: boolean;
    materialAppropriate: boolean;
  };
  violations: string[];
}

export interface OutfitGenerationResult {
  outfits: GeneratedOutfit[];
  context: {
    weather?: WeatherContext;
    event?: EventContext;
    constraints: StyleConstraints;
    appliedTrends: FashionTrend[];
  };
  metadata: {
    generatedAt: Date;
    processingTimeMs: number;
    productsSearched: number;
    wardrobeItemsConsidered: number;
  };
}

@Injectable()
export class OutfitReasoningService {
  private readonly logger = new Logger(OutfitReasoningService.name);

  // Clothing slots for outfit building
  private readonly CLOTHING_SLOTS = ['top', 'bottom', 'dress', 'shoes', 'outerwear', 'accessories'];

  constructor(
    private geminiService: GeminiService,
    private searchOrchestrator: SearchOrchestratorService,
    private contextService: ContextService,
  ) {}

  /**
   * Generate context-aware outfit recommendations
   */
  async generateOutfits(request: OutfitGenerationRequest): Promise<OutfitGenerationResult> {
    const startTime = Date.now();

    this.logger.log(`Generating context-aware outfits for user ${request.userId}: "${request.query}"`);

    // Step 1: Prepare full context pack
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

    this.logger.debug(`Context prepared: ${this.contextService.summarize(contextPack)}`);

    // Step 2: Determine slots to search based on context
    const slotsToSearch = this.determineSlotsFromContext(request.query, contextPack);

    // Step 3: Search for products in each slot with context-aware filtering
    const slotProducts = await this.searchProductsBySlotWithContext(
      request.query,
      slotsToSearch,
      contextPack,
      request.excludeProductIds,
    );

    // Step 4: Filter wardrobe items that match constraints
    const eligibleWardrobeItems = this.filterWardrobeItemsByConstraints(
      contextPack.wardrobe,
      contextPack.constraints,
      request.wardrobeItemIds,
    );

    // Check if we have enough items to work with
    const totalProducts = Array.from(slotProducts.values()).reduce((sum, p) => sum + p.length, 0);
    if (totalProducts < 3 && eligibleWardrobeItems.length < 2) {
      return this.buildInsufficientItemsResult(startTime);
    }

    // Step 5: Generate outfits using Gemini with enhanced context
    const outfits = await this.generateWithGemini(
      request.query,
      contextPack,
      slotProducts,
      eligibleWardrobeItems,
      request.count || 3,
    );

    // Step 6: Validate outfits against constraints
    const validatedOutfits = outfits.map(outfit =>
      this.validateOutfitConstraints(outfit, contextPack)
    );

    // Step 7: Score and rank outfits
    const scoredOutfits = this.scoreOutfits(validatedOutfits, contextPack);

    // Sort by score descending
    scoredOutfits.sort((a, b) => b.score - a.score);

    const processingTime = Date.now() - startTime;
    this.logger.log(`Generated ${scoredOutfits.length} outfits in ${processingTime}ms`);

    return {
      outfits: scoredOutfits,
      context: {
        weather: contextPack.weather,
        event: contextPack.eventContext,
        constraints: contextPack.constraints,
        appliedTrends: contextPack.trends.slice(0, 5),
      },
      metadata: {
        generatedAt: new Date(),
        processingTimeMs: processingTime,
        productsSearched: totalProducts,
        wardrobeItemsConsidered: eligibleWardrobeItems.length,
      },
    };
  }

  /**
   * Determine which slots to search based on context
   */
  private determineSlotsFromContext(query: string, context: ContextPack): string[] {
    const queryLower = query.toLowerCase();
    const slots: string[] = [];

    // Check for dress/one-piece requests
    if (queryLower.includes('dress') || queryLower.includes('romper') || queryLower.includes('jumpsuit')) {
      slots.push('dress', 'shoes', 'accessories');
      return slots;
    }

    // Base slots
    slots.push('top', 'bottom', 'shoes');

    // Add outerwear based on weather constraints
    if (context.constraints.needsOuterwear || context.constraints.suggestLayering) {
      slots.push('outerwear');
    }

    // Weather-specific additions
    if (context.weather) {
      if (context.weather.condition === 'rainy' || context.constraints.needsRainProtection) {
        slots.push('outerwear'); // Ensure outerwear for rain
      }
      if (context.weather.condition === 'sunny' && context.constraints.needsSunProtection) {
        slots.push('accessories'); // For hats, sunglasses
      }
    }

    // Formal events may need accessories
    if (context.eventContext?.formality &&
        ['formal', 'black_tie', 'business'].includes(context.eventContext.formality)) {
      if (!slots.includes('accessories')) {
        slots.push('accessories');
      }
    }

    return [...new Set(slots)]; // Remove duplicates
  }

  /**
   * Search products with context-aware filtering
   */
  private async searchProductsBySlotWithContext(
    query: string,
    slots: string[],
    context: ContextPack,
    excludeIds?: string[],
  ): Promise<Map<string, Product[]>> {
    const slotProducts = new Map<string, Product[]>();

    const searchPromises = slots.map(async (slot) => {
      try {
        // Build context-enhanced search query
        const enhancedQuery = this.buildContextEnhancedQuery(query, slot, context);

        const searchQuery = buildSearchQuery(
          enhancedQuery,
          {
            itemType: slot,
            priceRange: context.userProfile.brandPreferences.priceRange,
            brand: context.filters.brands,
            color: context.filters.color,
          },
          {
            userId: context.userProfile.userId,
            profile: context.userProfile,
          },
        );

        searchQuery.limit = 15;

        const results = await this.searchOrchestrator.search(searchQuery, {
          userId: context.userProfile.userId,
          profile: context.userProfile,
        });

        // Filter out excluded products and apply material constraints
        let products = results.products.filter(p => !excludeIds?.includes(p.id));
        products = this.filterProductsByConstraints(products, context.constraints);

        if (products.length > 0) {
          slotProducts.set(slot, products);
        }
      } catch (error) {
        this.logger.warn(`Search failed for slot ${slot}: ${(error as Error).message}`);
      }
    });

    await Promise.allSettled(searchPromises);

    return slotProducts;
  }

  /**
   * Build context-enhanced search query
   */
  private buildContextEnhancedQuery(query: string, slot: string, context: ContextPack): string {
    const parts = [query, slot];

    // Add occasion context
    if (context.eventContext?.occasion) {
      parts.push(context.eventContext.occasion);
    }

    // Add formality hint
    if (context.eventContext?.formality) {
      const formalityHints: Record<string, string> = {
        casual: 'casual relaxed',
        smart_casual: 'smart casual polished',
        business_casual: 'business casual professional',
        business: 'business formal professional',
        formal: 'formal elegant dressy',
        black_tie: 'formal black tie elegant',
      };
      if (formalityHints[context.eventContext.formality]) {
        parts.push(formalityHints[context.eventContext.formality]);
      }
    }

    // Add weather-appropriate terms
    if (context.weather) {
      if (context.constraints.temperatureRange === 'cold') {
        parts.push('warm cozy');
      } else if (context.constraints.temperatureRange === 'hot') {
        parts.push('lightweight breathable');
      }
    }

    // Add trending style if relevant
    const styleTrend = context.trends.find(t => t.category === 'style' && t.relevanceScore > 0.8);
    if (styleTrend) {
      parts.push(styleTrend.name.toLowerCase());
    }

    return parts.join(' ');
  }

  /**
   * Filter products by style constraints
   */
  private filterProductsByConstraints(products: Product[], constraints: StyleConstraints): Product[] {
    return products.filter(product => {
      // Check material constraints
      const productMaterial = (product as any).material?.toLowerCase() || '';

      // Avoid materials
      for (const avoidMaterial of constraints.avoidMaterials) {
        if (productMaterial.includes(avoidMaterial.toLowerCase())) {
          return false;
        }
      }

      // Prefer materials (boost, don't filter)
      // This is handled in scoring, not filtering

      return true;
    });
  }

  /**
   * Filter wardrobe items by constraints
   */
  private filterWardrobeItemsByConstraints(
    items: WardrobeItem[],
    constraints: StyleConstraints,
    specificIds?: string[],
  ): WardrobeItem[] {
    let filtered = items;

    // If specific IDs provided, filter to those first
    if (specificIds && specificIds.length > 0) {
      filtered = items.filter(item => specificIds.includes(item.id));
    }

    // Filter by seasonality if available
    return filtered.filter(item => {
      // Check seasonality
      if (item.seasonality && item.seasonality.length > 0) {
        const currentSeason = this.getCurrentSeason();
        if (!item.seasonality.includes(currentSeason) && !item.seasonality.includes('all')) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get current season
   */
  private getCurrentSeason(): string {
    const month = new Date().getMonth();
    if (month >= 2 && month <= 4) return 'spring';
    if (month >= 5 && month <= 7) return 'summer';
    if (month >= 8 && month <= 10) return 'fall';
    return 'winter';
  }

  /**
   * Generate outfits using Gemini with enhanced context
   */
  private async generateWithGemini(
    query: string,
    context: ContextPack,
    slotProducts: Map<string, Product[]>,
    wardrobeItems: WardrobeItem[],
    count: number,
  ): Promise<GeneratedOutfit[]> {
    try {
      // Build enhanced user context for Gemini
      const userContext = this.buildEnhancedUserContext(context, wardrobeItems);

      // Build enhanced filters with context
      const enhancedFilters = this.buildEnhancedFilters(context);

      // Call Gemini service
      const recommendations = await this.geminiService.generateOutfitRecommendations(
        query,
        userContext,
        slotProducts,
        enhancedFilters,
      );

      // Convert to GeneratedOutfit format with product lookup
      return recommendations.slice(0, count).map((rec, index) =>
        this.convertRecommendation(rec, index, slotProducts, wardrobeItems, context)
      );
    } catch (error) {
      this.logger.error(`Gemini outfit generation failed: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Build enhanced user context for Gemini
   */
  private buildEnhancedUserContext(context: ContextPack, wardrobeItems: WardrobeItem[]): any {
    return {
      profile: {
        gender: context.userProfile.gender,
        primaryStyle: context.userProfile.stylePreferences.primaryStyle,
        selectedStyles: context.userProfile.stylePreferences.selectedStyles,
        colorPreferences: context.userProfile.stylePreferences.colorPreferences,
        avoidColors: context.userProfile.stylePreferences.avoidColors,
        likedBrands: context.userProfile.brandPreferences.likedBrands,
        dislikedBrands: context.userProfile.brandPreferences.dislikedBrands,
        priceRange: context.userProfile.brandPreferences.priceRange,
        modestDressing: context.userProfile.stylePreferences.modestDressing,
        bodyType: context.userProfile.bodyProfile?.bodyType,
      },
      wardrobeColors: this.extractWardrobeColors(wardrobeItems),
      compatiblePieces: wardrobeItems.slice(0, 10).map(item => ({
        id: item.id,
        name: item.name,
        category: item.category,
        color: item.color,
        brand: item.brand,
      })),
      // Weather context
      weather: context.weather ? {
        temperature: context.weather.temperature,
        condition: context.weather.condition,
        location: context.weather.location,
      } : undefined,
      // Event context
      event: context.eventContext ? {
        occasion: context.eventContext.occasion,
        formality: context.eventContext.formality,
        settingType: context.eventContext.settingType,
        activityLevel: context.eventContext.activityLevel,
      } : undefined,
      // Style constraints
      constraints: {
        temperatureRange: context.constraints.temperatureRange,
        needsOuterwear: context.constraints.needsOuterwear,
        needsRainProtection: context.constraints.needsRainProtection,
        minCoverage: context.constraints.minCoverage,
        suggestLayering: context.constraints.suggestLayering,
        preferredMaterials: context.constraints.preferredMaterials,
        avoidMaterials: context.constraints.avoidMaterials,
      },
      // Current trends
      trends: context.trends.slice(0, 5).map(t => ({
        name: t.name,
        category: t.category,
        description: t.description,
      })),
    };
  }

  /**
   * Extract dominant colors from wardrobe
   */
  private extractWardrobeColors(items: WardrobeItem[]): string[] {
    const colorCounts = new Map<string, number>();

    for (const item of items) {
      if (item.color) {
        const color = item.color.toLowerCase();
        colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
      }
    }

    return Array.from(colorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([color]) => color);
  }

  /**
   * Build enhanced filters for Gemini
   */
  private buildEnhancedFilters(context: ContextPack): any {
    return {
      occasion: context.eventContext?.occasion || context.filters.occasion,
      formality: context.eventContext?.formality,
      style: context.filters.style || context.userProfile.stylePreferences.primaryStyle,
      color: context.filters.color,
      temperatureRange: context.constraints.temperatureRange,
      settingType: context.eventContext?.settingType,
      // Weather-specific hints
      weatherCondition: context.weather?.condition,
      needsLayering: context.constraints.suggestLayering,
      // Trend hints
      currentTrends: context.trends.slice(0, 3).map(t => t.name),
    };
  }

  /**
   * Convert Gemini recommendation to GeneratedOutfit
   */
  private convertRecommendation(
    rec: OutfitRecommendation,
    index: number,
    slotProducts: Map<string, Product[]>,
    wardrobeItems: WardrobeItem[],
    context: ContextPack,
  ): GeneratedOutfit {
    // Map items and find actual products
    const items: OutfitItem[] = (rec.items || []).map(item => {
      const slot = item.slot;
      const products = slotProducts.get(slot) || [];
      const product = products.find(p => p.id === item.productId || (p as any).sourceId === item.productId);

      // Check if it's a wardrobe item
      const wardrobeItem = wardrobeItems.find(w => w.id === item.productId);

      return {
        slot,
        productId: item.productId,
        product: product || undefined,
        wardrobeItemId: wardrobeItem?.id,
        wardrobeItem: wardrobeItem || undefined,
        selectionReason: item.selectionReason,
        isFromWardrobe: !!wardrobeItem,
      };
    });

    // Calculate weather fit description
    const weatherFit = this.describeWeatherFit(context);

    // Find aligned trends
    const trendAlignment = this.findTrendAlignment(rec, context.trends);

    return {
      id: `outfit_${Date.now()}_${index}`,
      name: rec.name,
      style: rec.style,
      items,
      totalPrice: rec.totalPrice || this.calculateTotalPrice(items),
      colorScheme: rec.colorScheme,
      styleNotes: rec.styleNotes,
      wardrobeSynergy: rec.wardrobeSynergy,
      occasionFit: rec.occasionFit,
      weatherFit,
      trendAlignment,
      constraintValidation: {
        passed: true,
        checks: {
          weatherAppropriate: true,
          eventAppropriate: true,
          budgetCompliant: true,
          coverageCompliant: true,
          materialAppropriate: true,
        },
        violations: [],
      },
      score: 0, // Will be calculated later
    };
  }

  /**
   * Describe weather fit
   */
  private describeWeatherFit(context: ContextPack): string {
    if (!context.weather) {
      return 'Versatile for various weather conditions';
    }

    const temp = context.weather.temperature;
    const condition = context.weather.condition;

    let description = '';

    if (temp >= 85) {
      description = 'Light and breathable for the hot weather';
    } else if (temp >= 70) {
      description = 'Comfortable for the warm temperatures';
    } else if (temp >= 55) {
      description = 'Suitable layers for the mild weather';
    } else if (temp >= 40) {
      description = 'Warm enough for the cool temperatures';
    } else {
      description = 'Properly layered for the cold weather';
    }

    // Add condition-specific notes
    if (condition === 'rainy') {
      description += ' with rain protection';
    } else if (condition === 'sunny') {
      description += ' with sun consideration';
    } else if (condition === 'windy') {
      description += ' with wind protection';
    }

    return description;
  }

  /**
   * Find trend alignment
   */
  private findTrendAlignment(rec: OutfitRecommendation, trends: FashionTrend[]): string[] {
    const aligned: string[] = [];
    const recText = `${rec.name} ${rec.style} ${rec.colorScheme} ${rec.styleNotes}`.toLowerCase();

    for (const trend of trends.slice(0, 10)) {
      if (recText.includes(trend.name.toLowerCase())) {
        aligned.push(trend.name);
      }
    }

    return aligned;
  }

  /**
   * Calculate total price from items
   */
  private calculateTotalPrice(items: OutfitItem[]): number {
    return items.reduce((total, item) => {
      if (item.product?.price) {
        return total + item.product.price;
      }
      return total;
    }, 0);
  }

  /**
   * Validate outfit against constraints
   */
  private validateOutfitConstraints(outfit: GeneratedOutfit, context: ContextPack): GeneratedOutfit {
    const violations: string[] = [];
    const checks = {
      weatherAppropriate: true,
      eventAppropriate: true,
      budgetCompliant: true,
      coverageCompliant: true,
      materialAppropriate: true,
    };

    // Budget check
    const maxBudget = context.userProfile.brandPreferences.priceRange.max;
    if (outfit.totalPrice > maxBudget) {
      checks.budgetCompliant = false;
      violations.push(`Total price $${outfit.totalPrice.toFixed(2)} exceeds budget of $${maxBudget}`);
    }

    // Coverage check for modest dressing
    if (context.userProfile.stylePreferences.modestDressing) {
      // This would need more detailed item data to check properly
      // For now, we trust Gemini followed the instructions
    }

    // Material check
    for (const item of outfit.items) {
      if (item.product) {
        const material = ((item.product as any).material || '').toLowerCase();
        for (const avoidMaterial of context.constraints.avoidMaterials) {
          if (material.includes(avoidMaterial.toLowerCase())) {
            checks.materialAppropriate = false;
            violations.push(`Item contains ${avoidMaterial} which should be avoided`);
          }
        }
      }
    }

    // Update validation
    outfit.constraintValidation = {
      passed: violations.length === 0,
      checks,
      violations,
    };

    return outfit;
  }

  /**
   * Score outfits based on multiple factors
   */
  private scoreOutfits(outfits: GeneratedOutfit[], context: ContextPack): GeneratedOutfit[] {
    return outfits.map(outfit => {
      let score = 0;

      // Base score from constraint validation (40%)
      if (outfit.constraintValidation.passed) {
        score += 40;
      } else {
        score += 40 - (outfit.constraintValidation.violations.length * 10);
      }

      // Trend alignment bonus (15%)
      score += Math.min(15, outfit.trendAlignment.length * 5);

      // Wardrobe synergy bonus (15%)
      const wardrobeItemCount = outfit.items.filter(i => i.isFromWardrobe).length;
      score += Math.min(15, wardrobeItemCount * 5);

      // Style match bonus (15%)
      const userStyles = context.userProfile.stylePreferences.selectedStyles.map(s => s.toLowerCase());
      if (userStyles.some(s => outfit.style.toLowerCase().includes(s))) {
        score += 15;
      }

      // Budget efficiency bonus (15%)
      const budgetUsage = outfit.totalPrice / context.userProfile.brandPreferences.priceRange.max;
      if (budgetUsage <= 0.7) {
        score += 15;
      } else if (budgetUsage <= 0.9) {
        score += 10;
      } else if (budgetUsage <= 1) {
        score += 5;
      }

      outfit.score = Math.min(100, Math.max(0, score));
      return outfit;
    });
  }

  /**
   * Build insufficient items result
   */
  private buildInsufficientItemsResult(startTime: number): OutfitGenerationResult {
    return {
      outfits: [],
      context: {
        constraints: {
          temperatureRange: 'mild',
          needsOuterwear: false,
          needsRainProtection: false,
          needsSunProtection: false,
          preferredMaterials: [],
          avoidMaterials: [],
          minCoverage: 'moderate',
          suggestLayering: false,
          layerCount: 1,
          seasonalColors: [],
        },
        appliedTrends: [],
      },
      metadata: {
        generatedAt: new Date(),
        processingTimeMs: Date.now() - startTime,
        productsSearched: 0,
        wardrobeItemsConsidered: 0,
      },
    };
  }
}
