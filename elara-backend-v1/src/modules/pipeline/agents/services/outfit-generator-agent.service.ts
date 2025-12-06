import { Injectable, Logger, Optional } from '@nestjs/common';
import { ClaudeService } from '../../infrastructure/llm/claude.service';
import { GeminiService } from '../../infrastructure/llm/gemini.service';
import { SearchOrchestratorService } from '../../search/search-orchestrator.service';
import { buildSearchQuery } from '../../search/dto/search-query.dto';
import { Product } from '../../search/dto/product.dto';
import { AgentResponse, ResponseType } from '../dto/chat-message.dto';
import { RoutingDecision } from './intent-router.service';
import {
  OutfitRecommendationScoringService,
  ScoringContext,
} from '../../outfit-scoring/services/outfit-recommendation-scoring.service';
import {
  normalizeSlotName,
  validateAndCorrectOutfitSlots,
  getValidSlotForProduct,
  validateItemForSlot,
  SLOT_TO_CATEGORIES,
} from '../../utilities/slot-category-mapping';
import { WardrobeService } from '../../../wardrobe/application/services/wardrobe.service';
import {
  ConstraintStoreService,
  ConstraintType,
} from '../../context/services/constraint-store.service';
import { WeatherService } from '../../context/services/weather.service';
import {
  WeatherContext,
  TEMPERATURE_RANGES,
  MATERIAL_BY_TEMPERATURE,
} from '../../context/dto/context-pack.dto';
import {
  FashionReasoningService,
  SafetyValidationContext,
  SafetyValidationResult,
} from '../../reasoning/fashion-reasoning.service';

/**
 * Wardrobe item interface for type safety
 */
interface WardrobeItem {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  color?: string;
  brand?: string;
  imageUrl?: string;
  occasions?: string[];
  style?: string[];
  isFromWardrobe: true;
}

/**
 * Outfit strategy for 3-tier generation
 */
enum OutfitStrategy {
  WARDROBE_ONLY = 'wardrobe_only',
  HYBRID = 'hybrid',
  SHOPPING_ONLY = 'shopping_only',
}

/**
 * Outfit Generator Agent
 *
 * Creates complete outfit recommendations using AI.
 * Combines SearchOrchestrator for product discovery with
 * Gemini for intelligent outfit combination.
 *
 * ENHANCED: Now follows Python pipeline pattern:
 * - Returns exactly 3 outfits
 * - Each outfit has 5-6 items (men) or 7-8 items (women)
 * - Mandatory accessories (2-3 for men, 4-5 for women)
 * - Uses deterministic scoring matrix
 *
 * Workflow:
 * 1. Search for products in each clothing slot
 * 2. Group products by slot (top, bottom, shoes, accessories, etc.)
 * 3. Use Gemini to generate 3 outfit combinations
 * 4. Score each outfit using deterministic scoring matrix
 * 5. Format and present to user (sorted by score)
 */
@Injectable()
export class OutfitGeneratorAgentService {
  private readonly logger = new Logger(OutfitGeneratorAgentService.name);

  // Minimum items per outfit (men: 5-6, women: 7-8)
  private readonly MIN_ITEMS_MEN = 5;
  private readonly MIN_ITEMS_WOMEN = 7;
  private readonly TARGET_OUTFITS = 3;

  // Clothing slots for outfit building - ENHANCED with accessories
  private readonly CLOTHING_SLOTS = [
    'top',
    'bottom',
    'dress',
    'shoes',
    'outerwear',
    'accessories',
  ];

  // Accessory types for men and women
  private readonly ACCESSORY_TYPES_MEN = ['watch', 'belt', 'sunglasses', 'bag', 'hat'];
  private readonly ACCESSORY_TYPES_WOMEN = ['bag', 'jewelry', 'sunglasses', 'belt', 'scarf', 'watch'];

  constructor(
    private claudeService: ClaudeService,
    private geminiService: GeminiService,
    private searchOrchestrator: SearchOrchestratorService,
    private scoringService: OutfitRecommendationScoringService,
    @Optional() private wardrobeService?: WardrobeService,
    @Optional() private constraintStoreService?: ConstraintStoreService,
    @Optional() private weatherService?: WeatherService,
    @Optional() private fashionReasoningService?: FashionReasoningService,
  ) {}

  /**
   * Generate outfit recommendations
   * ENHANCED: Now returns exactly 3 outfits with 5-6 items each, scored and ranked
   */
  async execute(
    message: string,
    routing: RoutingDecision,
    userContext?: any,
  ): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      this.logger.log(`Generating outfit recommendations for: "${message}"`);

      // Determine gender for item count requirements
      // Priority: routing.filters.gender (from message) > userContext.gender (from profile) > default 'men'
      const rawGender = (routing.filters?.gender || userContext?.gender || 'men').toLowerCase();
      // Normalize gender: male -> men, female -> women
      const gender = (rawGender === 'male' || rawGender === 'man') ? 'men' : (rawGender === 'female' || rawGender === 'woman') ? 'women' : rawGender;
      const minItems = gender === 'women' ? this.MIN_ITEMS_WOMEN : this.MIN_ITEMS_MEN;

      // Extract userId for wardrobe integration
      const userId = userContext?.userId || userContext?.user?.id || userContext?.profile?.userId;

      // ============================================================
      // WARDROBE-FIRST STRATEGY (3-TIER OUTFIT GENERATION)
      // ============================================================
      // If user has an ID and WardrobeService is available, use the 3-tier strategy:
      // - Outfit 1: Wardrobe only (if possible)
      // - Outfit 2: Hybrid (wardrobe + shopping)
      // - Outfit 3: Shopping only
      // If wardrobe is empty or unavailable, all 3 outfits are shopping-based
      // ============================================================

      let outfits: any[] = [];
      let slotProducts: Map<string, Product[]>;
      let hasWardrobe = false;

      if (userId && this.wardrobeService) {
        this.logger.log(`Using wardrobe-first strategy for user: ${userId}`);

        try {
          const wardrobeResult = await this.generateOutfitsWithWardrobeStrategy(
            message,
            routing.filters,
            userContext,
            userId,
          );

          outfits = wardrobeResult.outfits;
          slotProducts = wardrobeResult.slotProducts;
          hasWardrobe = wardrobeResult.hasWardrobe;

          this.logger.log(
            `Wardrobe strategy: ${outfits.length} outfits generated, hasWardrobe=${hasWardrobe}`,
          );
        } catch (wardrobeError: any) {
          this.logger.warn(
            `Wardrobe strategy failed: ${wardrobeError.message}, falling back to shopping-only`,
          );
          // Fall through to standard flow
          slotProducts = await this.searchProductsBySlot(message, routing.filters, userContext);
        }
      } else {
        // No userId or WardrobeService - use standard shopping-only flow
        this.logger.log('No userId or WardrobeService - using shopping-only strategy');
        slotProducts = await this.searchProductsBySlot(message, routing.filters, userContext);
      }

      // ============================================================
      // WEATHER INTEGRATION: Apply weather constraints to products
      // ============================================================
      let weatherContext: WeatherContext | undefined;
      const userLocation = userContext?.location?.city || userContext?.profile?.location?.city;

      if (this.weatherService && userLocation) {
        try {
          weatherContext = await this.weatherService.getWeather(userLocation);
          if (weatherContext) {
            this.logger.log(
              `Weather for ${userLocation}: ${weatherContext.temperature}°F, ${weatherContext.condition}`,
            );

            // Apply weather constraints to filter/prioritize products
            slotProducts = this.applyWeatherConstraints(slotProducts, weatherContext);
          }
        } catch (weatherError: any) {
          this.logger.warn(`Weather fetch failed: ${weatherError.message}, continuing without weather`);
        }
      }

      // Check if we have enough products (only if outfits weren't already generated)
      if (outfits.length === 0) {
        const totalProducts = Array.from(slotProducts.values()).reduce(
          (sum, products) => sum + products.length,
          0,
        );

        if (totalProducts < 3) {
          return this.buildInsufficientProductsResponse();
        }

        // Generate outfit combinations using Claude (with Gemini fallback)
        try {
          this.logger.log('Generating outfits with Claude Sonnet...');
          outfits = await this.claudeService.generateOutfitRecommendations(
            message,
            userContext,
            slotProducts,
            routing.filters,
          );
          this.logger.log(`Claude returned ${outfits.length} outfits`);
        } catch (claudeError: any) {
          this.logger.warn(`Claude failed: ${claudeError.message}, falling back to Gemini`);
          try {
            outfits = await this.geminiService.generateOutfitRecommendations(
              message,
              userContext,
              slotProducts,
              routing.filters,
            );
            this.logger.log(`Gemini fallback returned ${outfits.length} outfits`);
          } catch (geminiError: any) {
            this.logger.error(`Both LLMs failed: ${geminiError.message}`);
          }
        }
      }

      if (outfits.length === 0) {
        return this.buildNoOutfitsResponse();
      }

      // Ensure we have exactly 3 outfits with proper item counts
      outfits = this.ensureCompleteOutfits(outfits, slotProducts, minItems, gender);

      // Validate outfits have required slots (PORTED FROM PYTHON)
      outfits = this.validateAndFixOutfits(outfits, slotProducts, gender);

      // CRITICAL - Validate and correct slot-category assignments
      // This fixes issues like pants appearing in "outerwear" slot
      outfits = this.validateSlotCategoryAssignments(outfits, slotProducts);

      // Score and rank outfits using deterministic scoring matrix
      const scoringContext = this.buildScoringContext(userContext, routing.filters);
      const scoredOutfits = this.scoringService.scoreAndRankOutfits(
        outfits.map((o: any) => ({
          ...o,
          items: (o.items || []).map((item: any) => {
            // CRITICAL: Use centralized slot normalization
            const rawSlotName = item.slot || item.category || '';
            const slotName = normalizeSlotName(rawSlotName);

            // Try to find product in the normalized slot first, then fall back to original
            let products = slotProducts.get(slotName) || [];
            if (products.length === 0) {
              // Fallback: search all slots for this product
              products = this.findProductAcrossSlots(item.productId, slotProducts);
            }

            const product = products.find(
              (p) => p.id === item.productId || p.sourceId === item.productId,
            );

            // If product found, verify it belongs in the assigned slot
            const finalSlot = product ? getValidSlotForProduct(product, slotName) : slotName;

            return {
              slot: finalSlot,
              productId: item.productId, // CRITICAL: Preserve productId for later lookup
              name: product?.title || item.productId,
              source: product?.retailer || 'Unknown',
              retailer: product?.retailer || 'Unknown',
              price: product?.price
                ? { value: product.price, currency: product.currency || 'USD' }
                : undefined,
              // Preserve wardrobe flag for frontend display
              isFromWardrobe: item.isFromWardrobe || false,
            };
          }),
        })),
        scoringContext,
      );

      // Take top 3 outfits
      let top3Outfits = scoredOutfits.slice(0, this.TARGET_OUTFITS);

      this.logger.log(
        `Generated ${top3Outfits.length} outfits, scores: ${top3Outfits.map((o) => o.score).join(', ')}`,
      );

      // ============================================================
      // SAFETY & CULTURAL VALIDATION
      // ============================================================
      // Validate each outfit for safety and cultural appropriateness
      // Add warnings/suggestions without blocking outfit display
      const safetyValidations: Array<SafetyValidationResult | null> = [];

      if (this.fashionReasoningService) {
        const safetyContext: SafetyValidationContext = {
          weather: weatherContext ? {
            temperature: weatherContext.temperature,
            condition: weatherContext.condition,
            precipitation: weatherContext.precipitation,
          } : undefined,
          venue: routing.filters?.venue || routing.filters?.occasion || 'general',
          occasion: routing.filters?.occasion || 'casual',
          culturalContext: routing.filters?.culturalContext || userContext?.profile?.culturalPreferences,
        };

        for (const outfit of top3Outfits) {
          try {
            const outfitItems = (outfit.items || []).map((item: any) => ({
              name: item.name || item.productId || 'Unknown item',
              category: item.slot,
            }));

            const validation = await this.fashionReasoningService.validateOutfitSafety(
              outfitItems,
              safetyContext,
            );

            safetyValidations.push(validation);

            // Add safety info to outfit
            outfit.safetyValidation = validation;

            // Log any concerns
            if (!validation.isSafe || validation.concerns.length > 0) {
              this.logger.warn(
                `Outfit "${outfit.name}": Safety concerns: ${validation.concerns.join(', ')}`,
              );
            }
          } catch (validationError: any) {
            this.logger.debug(`Safety validation failed for outfit: ${validationError.message}`);
            safetyValidations.push(null);
          }
        }
      }

      // Format response (pass slotProducts for product lookup)
      const response = this.formatOutfitResponse(message, top3Outfits, slotProducts);

      // Add metadata including wardrobe info and safety validations
      response.metadata = {
        intent: routing.intent,
        confidence: routing.confidence,
        agentUsed: 'outfit_generator',
        processingTime: Date.now() - startTime,
        outfitCount: top3Outfits.length,
        scores: top3Outfits.map((o) => o.score),
        hasWardrobe,
        strategies: top3Outfits.map((o) => o.strategy || OutfitStrategy.SHOPPING_ONLY),
        weatherApplied: !!weatherContext,
        safetyValidated: safetyValidations.filter(v => v !== null).length > 0,
      };

      this.logger.log(
        `Generated ${top3Outfits.length} scored outfits in ${Date.now() - startTime}ms`,
      );

      return response;
    } catch (error) {
      this.logger.error(
        `Outfit generation failed: ${(error as Error).message}`,
      );

      return {
        message: "I'm having trouble creating outfits right now. Let me show you individual products instead.",
        type: ResponseType.ERROR,
        metadata: {
          intent: routing.intent,
          confidence: routing.confidence,
          agentUsed: 'outfit_generator',
          processingTime: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Build scoring context from user context and filters
   */
  private buildScoringContext(userContext: any, filters: any): ScoringContext {
    return {
      session: {
        occasion: filters?.occasion || userContext?.occasion || 'casual',
        vibe: filters?.vibe || userContext?.vibe || 'casual',
        location: userContext?.location,
      },
      user_profile: {
        gender: userContext?.gender,
        skin_tone: userContext?.skin_tone,
        body_type: userContext?.body_type,
        fit_pref: userContext?.fit_pref,
        color_prefs: userContext?.color_prefs || [],
        brand_prefs: userContext?.brand_prefs || [],
      },
      derived: {
        temp_band: this.deriveTempBand(userContext?.weather),
        rain: userContext?.weather?.precipitation > 0,
      },
      constraints: {
        budget: {
          soft_cap: filters?.maxPrice || userContext?.budget?.soft_cap || 150,
          hard_cap: (filters?.maxPrice || 150) * 2,
        },
      },
      trend_tags: [
        { tag: 'minimalist', w: 0.5 },
        { tag: 'neutral', w: 0.5 },
        { tag: 'relaxed-fit', w: 0.3 },
        { tag: 'linen', w: 0.3 },
      ],
    };
  }

  /**
   * Derive temperature band from weather data
   */
  private deriveTempBand(weather: any): 'cold' | 'cool' | 'mild' | 'warm' {
    const temp = weather?.temp_c || weather?.temperature || 20;
    if (temp <= 10) return 'cold';
    if (temp <= 18) return 'cool';
    if (temp <= 24) return 'mild';
    return 'warm';
  }

  /**
   * Ensure outfits have minimum required items
   * Adds accessories if needed to meet minimum
   */
  private ensureCompleteOutfits(
    outfits: any[],
    slotProducts: Map<string, Product[]>,
    minItems: number,
    gender: string,
  ): any[] {
    const accessoryTypes = gender === 'women'
      ? this.ACCESSORY_TYPES_WOMEN
      : this.ACCESSORY_TYPES_MEN;

    return outfits.map((outfit, index) => {
      const items = outfit.items || [];

      // If outfit doesn't have enough items, add accessories
      if (items.length < minItems) {
        const accessories = slotProducts.get('accessories') || [];
        const accessoriesNeeded = minItems - items.length;

        // Add random accessories that aren't already in the outfit
        const existingIds = new Set(items.map((i: any) => i.productId));
        const availableAccessories = accessories.filter(
          (a) => !existingIds.has(a.id),
        );

        for (let i = 0; i < accessoriesNeeded && i < availableAccessories.length; i++) {
          const acc = availableAccessories[i];
          items.push({
            slot: 'accessory',
            productId: acc.id,
            selectionReason: 'Added to complete outfit',
          });
        }

        this.logger.debug(
          `Added ${Math.min(accessoriesNeeded, availableAccessories.length)} accessories to outfit ${index + 1}`,
        );
      }

      return { ...outfit, items };
    });
  }

  /**
   * Validate outfits have required slots and fix any issues
   * PORTED FROM PYTHON: Comprehensive validation with gender-specific requirements
   */
  private validateAndFixOutfits(
    outfits: any[],
    slotProducts: Map<string, Product[]>,
    gender: string,
  ): any[] {
    return outfits.map((outfit, index) => {
      const items = outfit.items || [];
      const slots = new Set<string>(items.map((i: any) => i.slot?.toLowerCase() as string).filter(Boolean));
      const validation = this.validateOutfitSlots(slots, gender);

      if (!validation.valid) {
        this.logger.warn(`Outfit ${index + 1} validation failed: ${validation.errors.join(', ')}`);

        // Try to fix missing slots
        for (const error of validation.errors) {
          if (error.includes('Top/Dress')) {
            const product = this.findProductForSlot(['top', 'dress'], slotProducts, items);
            if (product) {
              items.push({
                slot: 'top',
                productId: product.id,
                selectionReason: 'Added to complete outfit (validation fix)',
              });
              this.logger.log(`Fixed outfit ${index + 1}: Added top`);
            }
          } else if (error.includes('Bottom')) {
            const product = this.findProductForSlot(['bottom', 'pants', 'jeans', 'skirt'], slotProducts, items);
            if (product) {
              items.push({
                slot: 'bottom',
                productId: product.id,
                selectionReason: 'Added to complete outfit (validation fix)',
              });
              this.logger.log(`Fixed outfit ${index + 1}: Added bottom`);
            }
          } else if (error.includes('Footwear')) {
            const product = this.findProductForSlot(['shoes', 'footwear', 'sneakers', 'heels'], slotProducts, items);
            if (product) {
              items.push({
                slot: 'shoes',
                productId: product.id,
                selectionReason: 'Added to complete outfit (validation fix)',
              });
              this.logger.log(`Fixed outfit ${index + 1}: Added shoes`);
            }
          }
        }
      }

      return { ...outfit, items };
    });
  }

  /**
   * CRITICAL: Validate and correct slot-category assignments
   * This fixes the issue where LLM assigns items to wrong slots (e.g., pants in outerwear)
   * Uses centralized slot-category-mapping utility for validation
   */
  private validateSlotCategoryAssignments(
    outfits: any[],
    slotProducts: Map<string, Product[]>,
  ): any[] {
    return outfits.map((outfit, index) => {
      const correctedItems = validateAndCorrectOutfitSlots(
        outfit.items || [],
        slotProducts,
      );

      // Log any corrections made
      const originalSlots = (outfit.items || []).map((i: any) => i.slot);
      const correctedSlots = correctedItems.map((i: any) => i.slot);

      const corrections: string[] = [];
      for (let i = 0; i < originalSlots.length; i++) {
        if (originalSlots[i] !== correctedSlots[i]) {
          corrections.push(`${originalSlots[i]} → ${correctedSlots[i]}`);
        }
      }

      if (corrections.length > 0) {
        this.logger.warn(
          `Outfit ${index + 1}: Corrected slot assignments: ${corrections.join(', ')}`,
        );
      }

      return { ...outfit, items: correctedItems };
    });
  }

  /**
   * Find a product across all slots (fallback when slot doesn't match)
   */
  private findProductAcrossSlots(
    productId: string,
    slotProducts: Map<string, Product[]>,
  ): Product[] {
    for (const products of slotProducts.values()) {
      const found = products.find(
        (p) => p.id === productId || p.sourceId === productId,
      );
      if (found) return [found];
    }
    return [];
  }

  /**
   * Validate outfit has required slots
   */
  private validateOutfitSlots(slots: Set<string>, gender: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Required: Top or Dress or One-piece
    const hasTop = ['top', 'shirt', 'blouse', 'dress', 'jumpsuit', 'romper', 'one_piece'].some(s => slots.has(s));
    if (!hasTop) errors.push('Missing: Top/Dress/One-piece');

    // Required: Bottom (unless wearing dress/jumpsuit)
    const hasBottom = ['bottom', 'pants', 'jeans', 'skirt', 'shorts', 'trousers'].some(s => slots.has(s));
    const hasOnePiece = ['dress', 'jumpsuit', 'romper', 'one_piece'].some(s => slots.has(s));
    if (!hasBottom && !hasOnePiece) errors.push('Missing: Bottom/Pants');

    // Required: Footwear
    const hasFootwear = ['shoes', 'footwear', 'sneakers', 'heels', 'sandals', 'boots', 'loafers'].some(s => slots.has(s));
    if (!hasFootwear) errors.push('Missing: Footwear');

    // Check accessory count
    const accessorySlots = ['accessory', 'accessories', 'bag', 'jewelry', 'watch', 'belt', 'sunglasses', 'scarf', 'hat'];
    const accessoryCount = Array.from(slots).filter(s => accessorySlots.includes(s)).length;
    const minAccessories = gender === 'women' ? 3 : 2;

    if (accessoryCount < minAccessories) {
      errors.push(`Need ${minAccessories - accessoryCount} more accessories (have ${accessoryCount}, need ${minAccessories})`);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Find a product for a slot that isn't already in the outfit
   */
  private findProductForSlot(
    slotNames: string[],
    slotProducts: Map<string, Product[]>,
    existingItems: any[],
  ): Product | null {
    const existingIds = new Set(existingItems.map((i: any) => i.productId));

    for (const slotName of slotNames) {
      const products = slotProducts.get(slotName) || [];
      const available = products.filter(p => !existingIds.has(p.id));
      if (available.length > 0) {
        return available[0];
      }
    }

    return null;
  }

  /**
   * Search for products in each clothing slot
   * CRITICAL: Uses slot-specific search terms for relevant results
   * ENHANCED: Includes retry logic with progressive filter relaxation (ported from Python)
   */
  private async searchProductsBySlot(
    query: string,
    filters: any,
    userContext?: any,
  ): Promise<Map<string, Product[]>> {
    const slotProducts = new Map<string, Product[]>();

    // Determine which slots to search based on query
    const slotsToSearch = this.determineSlotsToSearch(query, filters);

    this.logger.debug(`Searching slots: ${slotsToSearch.join(', ')}`);

    // Search each slot in parallel with SLOT-SPECIFIC search terms and RETRY LOGIC
    const searchPromises = slotsToSearch.map(async (slot) => {
      try {
        const products = await this.searchSlotWithRetry(slot, filters, userContext);

        if (products.length > 0) {
          slotProducts.set(slot, products);
          this.logger.debug(`Slot "${slot}": found ${products.length} products`);
        } else {
          this.logger.warn(`Slot "${slot}": no products found after all retries`);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to search slot ${slot}: ${(error as Error).message}`,
        );
      }
    });

    await Promise.allSettled(searchPromises);

    return slotProducts;
  }

  /**
   * Search for a single slot with progressive filter relaxation
   * PORTED FROM PYTHON: 3-tier retry (strict → relaxed color → relaxed gender → ultra-relaxed)
   */
  private async searchSlotWithRetry(
    slot: string,
    filters: any,
    userContext?: any,
  ): Promise<Product[]> {
    // Build slot-specific search terms
    const slotSearchTerms = this.buildSlotSearchTerms(slot, filters, userContext);
    this.logger.debug(`Slot "${slot}" search terms: "${slotSearchTerms}"`);

    // TIER 1: Strict search with ONLY slot-specific filters
    // CRITICAL: Do NOT spread original filters - they contain dress-related terms
    // Only preserve relevant filters: color, gender, occasion, style
    const slotFilters = {
      itemType: slotSearchTerms,
      category: slot,
      // Only include universal filters, not item-specific ones
      color: filters.color,
      gender: filters.gender,
      occasion: filters.occasion,
      style: filters.style,
    };

    const slotQuery = buildSearchQuery(slotSearchTerms, slotFilters, userContext);
    slotQuery.limit = 15;

    // CRITICAL DEBUG: Log query created for each slot (use LOG level for visibility)
    this.logger.log(`[OutfitGen] Slot "${slot}" QUERY CREATED - terms="${slotQuery.terms}", itemType="${slotQuery.itemType}", category="${slotQuery.category}"`);

    let results = await this.searchOrchestrator.search(slotQuery, userContext);
    if (results.products.length > 0) {
      // CRITICAL: Filter products to ensure they actually belong in this slot
      const filteredProducts = this.filterProductsBySlotCategory(results.products, slot);
      if (filteredProducts.length > 0) {
        return filteredProducts;
      }
      this.logger.warn(`Slot "${slot}": ${results.products.length} products found but ${results.products.length - filteredProducts.length} filtered out (wrong category)`);
    }

    // TIER 2: Remove color filter
    this.logger.warn(`Slot "${slot}": Retry #1 - removing color filter`);
    const relaxedFilters = { ...slotFilters, color: undefined };
    const relaxedQuery = buildSearchQuery(slotSearchTerms, relaxedFilters, userContext);
    relaxedQuery.limit = 15;

    results = await this.searchOrchestrator.search(relaxedQuery, userContext);
    if (results.products.length > 0) {
      const filteredProducts = this.filterProductsBySlotCategory(results.products, slot);
      if (filteredProducts.length > 0) {
        this.logger.log(`Slot "${slot}": Found ${filteredProducts.length} products with relaxed color filter`);
        return filteredProducts;
      }
    }

    // TIER 3: Remove gender filter (broader search)
    this.logger.warn(`Slot "${slot}": Retry #2 - removing gender filter`);
    const ultraRelaxedFilters = { ...relaxedFilters, gender: undefined };
    const ultraRelaxedQuery = buildSearchQuery(slotSearchTerms, ultraRelaxedFilters, userContext);
    ultraRelaxedQuery.limit = 15;

    results = await this.searchOrchestrator.search(ultraRelaxedQuery, userContext);
    if (results.products.length > 0) {
      const filteredProducts = this.filterProductsBySlotCategory(results.products, slot);
      if (filteredProducts.length > 0) {
        this.logger.log(`Slot "${slot}": Found ${filteredProducts.length} products with relaxed gender filter`);
        return filteredProducts;
      }
    }

    // TIER 4: Ultra-relaxed - generic slot search
    this.logger.warn(`Slot "${slot}": Retry #3 - ultra-relaxed generic search`);
    // Priority: filters.gender (from message) > userContext.profile.gender (from profile) > default 'women'
    const rawGender = (filters?.gender || userContext?.profile?.gender || 'women').toLowerCase();
    // Normalize gender: male -> men, female -> women
    const gender = (rawGender === 'male' || rawGender === 'man') ? 'men' : (rawGender === 'female' || rawGender === 'woman') ? 'women' : rawGender;
    const genericTerms = `${gender} ${slot}`;
    const genericQuery = buildSearchQuery(genericTerms, { itemType: slot }, userContext);
    genericQuery.limit = 15;

    results = await this.searchOrchestrator.search(genericQuery, userContext);
    if (results.products.length > 0) {
      const filteredProducts = this.filterProductsBySlotCategory(results.products, slot);
      if (filteredProducts.length > 0) {
        this.logger.log(`Slot "${slot}": Found ${filteredProducts.length} products with generic search`);
        return filteredProducts;
      }
    }

    // TIER 5: Dedicated accessory search with specific product type keywords
    // This uses highly specific search terms that are more likely to return correct products
    const accessorySpecificTerms = this.getAccessorySpecificSearchTerms(slot, gender);
    if (accessorySpecificTerms) {
      this.logger.warn(`Slot "${slot}": Retry #4 - dedicated accessory search with "${accessorySpecificTerms}"`);
      const accessoryQuery = buildSearchQuery(accessorySpecificTerms, { itemType: slot }, userContext);
      accessoryQuery.limit = 20; // Increase limit for accessory searches

      results = await this.searchOrchestrator.search(accessoryQuery, userContext);
      if (results.products.length > 0) {
        const filteredProducts = this.filterProductsBySlotCategory(results.products, slot);
        if (filteredProducts.length > 0) {
          this.logger.log(`Slot "${slot}": Found ${filteredProducts.length} products with dedicated accessory search`);
          return filteredProducts;
        }
      }
    }

    return [];
  }

  /**
   * Get highly specific search terms for accessory slots
   * These terms are designed to return the correct product category
   */
  private getAccessorySpecificSearchTerms(slot: string, gender: string): string | null {
    // Normalize gender to match map keys (male/men -> men, female/women -> women)
    const normalizedGender = gender.toLowerCase();
    const genderKey = (normalizedGender === 'male' || normalizedGender === 'men' || normalizedGender === 'man') ? 'men' : 'women';

    const accessorySearchMap: Record<string, Record<string, string[]>> = {
      women: {
        shoes: [
          'high heels pumps',
          'strappy sandals heels',
          'stiletto heels',
          'block heel sandals',
          'evening shoes heels',
        ],
        heels: [
          'high heels pumps stiletto',
          'strappy heels evening',
          'block heel dress shoes',
        ],
        watch: [
          'womens watch bracelet',
          'ladies wristwatch',
          'womens analog watch',
          'dress watch women',
        ],
        belt: [
          'womens leather belt',
          'waist belt women',
          'dress belt ladies',
          'fashion belt women',
        ],
        sunglasses: [
          'womens sunglasses',
          'cat eye sunglasses',
          'oversized sunglasses women',
          'designer sunglasses ladies',
        ],
        bag: [
          'evening clutch bag',
          'crossbody bag women',
          'handbag purse',
          'shoulder bag women',
        ],
        jewelry: [
          'statement necklace earrings',
          'gold jewelry set',
          'fashion jewelry women',
        ],
      },
      men: {
        shoes: [
          'mens dress shoes oxford',
          'mens loafers leather',
          'oxford shoes men',
          'mens formal shoes',
        ],
        watch: [
          'mens watch leather strap',
          'mens analog watch',
          'dress watch men',
          'chronograph watch men',
        ],
        belt: [
          'mens leather belt',
          'dress belt men',
          'mens belt buckle',
        ],
        sunglasses: [
          'mens sunglasses aviator',
          'wayfarer sunglasses men',
          'polarized sunglasses men',
        ],
      },
    };

    const genderTerms = accessorySearchMap[genderKey];
    const slotTerms = genderTerms[slot];

    if (!slotTerms || slotTerms.length === 0) {
      return null;
    }

    // Return a random term from the list to increase variety
    return slotTerms[Math.floor(Math.random() * slotTerms.length)];
  }

  /**
   * Filter products to ensure they actually belong in the specified slot
   * Uses centralized slot-category mapping for validation
   * This prevents shirts appearing in outerwear slot, pants in top slot, etc.
   */
  private filterProductsBySlotCategory(products: Product[], slot: string): Product[] {
    const validProducts = products.filter(product => {
      const isValid = validateItemForSlot(product, slot);
      if (!isValid) {
        this.logger.debug(
          `Filtered out "${product.title?.substring(0, 40)}..." from slot "${slot}" - wrong category`,
        );
      }
      return isValid;
    });

    if (validProducts.length < products.length) {
      this.logger.log(
        `Slot "${slot}": Filtered ${products.length - validProducts.length} products that didn't match slot category`,
      );
    }

    return validProducts;
  }

  /**
   * Build slot-specific search terms based on the occasion and style
   * This ensures each slot gets relevant products (not dresses for shoes slot!)
   */
  private buildSlotSearchTerms(slot: string, filters: any, userContext?: any): string {
    const occasion = filters.occasion || 'casual';
    const style = filters.style || '';
    // Priority: filters.gender (from message) > userContext.profile.gender (from profile) > default 'women'
    const rawGender = (filters?.gender || userContext?.profile?.gender || 'women').toLowerCase();
    // Normalize gender: male -> men, female -> women
    const gender = (rawGender === 'male' || rawGender === 'man') ? 'men' : (rawGender === 'female' || rawGender === 'woman') ? 'women' : rawGender;
    const size = filters.size || '';

    // Occasion-based slot mappings for better search results
    const occasionSlotMap: Record<string, Record<string, string>> = {
      cocktail: {
        dress: 'cocktail dress evening dress',
        shoes: 'evening heels dress shoes',
        accessories: 'evening clutch bag',
        jewelry: 'statement jewelry earrings',
        clutch: 'evening clutch purse',
      },
      party: {
        dress: 'party dress evening dress',
        shoes: 'party heels strappy heels',
        accessories: 'evening bag clutch',
        jewelry: 'party jewelry statement',
        clutch: 'party clutch metallic',
      },
      formal: {
        dress: 'formal gown evening dress',
        shoes: 'formal heels dress shoes',
        accessories: 'formal clutch evening bag',
        jewelry: 'elegant jewelry pearls',
        clutch: 'formal evening clutch',
      },
      wedding: {
        dress: 'wedding guest dress formal',
        shoes: 'wedding guest heels elegant',
        accessories: 'wedding guest clutch',
        jewelry: 'elegant jewelry occasion',
        clutch: 'wedding clutch satin',
      },
      casual: {
        dress: 'casual dress day dress',
        top: 'casual top blouse',
        bottom: 'casual pants jeans',
        shoes: 'casual sneakers flats',
        accessories: 'casual bag tote',
        outerwear: 'casual jacket cardigan',
      },
      date: {
        dress: 'date night dress romantic',
        shoes: 'date night heels elegant',
        accessories: 'evening bag small',
        jewelry: 'delicate jewelry',
        clutch: 'small clutch evening',
      },
      work: {
        dress: 'work dress office professional',
        top: 'work blouse professional',
        bottom: 'work pants trousers',
        shoes: 'work heels professional',
        accessories: 'work bag tote',
        outerwear: 'blazer professional',
      },
    };

    // Get occasion-specific term or use generic
    const occasionTerms = occasionSlotMap[occasion.toLowerCase()] || occasionSlotMap.casual;
    let searchTerm = occasionTerms[slot] || `${gender} ${slot}`;

    // CRITICAL: For men's outfits, use specific search terms to avoid women's products
    // The occasionSlotMap has women-centric terms (heels, clutch, etc.) that don't work for men
    if (gender === 'men') {
      // Replace women-specific terms or generic terms with men-specific equivalents
      if (slot === 'shoes') {
        searchTerm = 'mens dress shoes oxford formal';
      } else if (slot === 'top') {
        // Differentiate between dress shirts and t-shirts based on occasion
        if (occasion === 'casual' || occasion === 'brunch') {
          searchTerm = 'mens button down casual shirt polo';
        } else {
          searchTerm = 'mens dress shirt button down formal';
        }
      } else if (slot === 'bottom') {
        searchTerm = `mens ${occasion} pants trousers dress pants`;
      } else if (slot === 'outerwear') {
        searchTerm = 'mens blazer suit jacket sport coat';
      } else if (slot === 'watch') {
        // Men's watches - use specific product terms
        searchTerm = 'mens wristwatch dress watch analog';
      } else if (slot === 'belt') {
        // Men's belts - use specific product terms
        searchTerm = 'mens leather belt dress belt';
      } else if (slot === 'sunglasses') {
        // Men's sunglasses - use specific product terms
        searchTerm = 'mens sunglasses aviator polarized';
      } else if (!searchTerm.toLowerCase().includes('men')) {
        searchTerm = `mens ${searchTerm}`;
      }
    }

    // Add style modifier ONLY for clothing items (not accessories/jewelry)
    const clothingSlots = ['dress', 'top', 'bottom', 'outerwear'];
    if (style && clothingSlots.includes(slot) && !searchTerm.includes(style)) {
      searchTerm = `${style} ${searchTerm}`;
    }

    // Add size ONLY for dresses (important for plus-size!)
    if (slot === 'dress' && size) {
      searchTerm = `${searchTerm} ${size}`;
    }

    // Add features like sleeves ONLY for dresses
    if (slot === 'dress' && filters.features?.length) {
      searchTerm = `${searchTerm} ${filters.features.join(' ')}`;
    }

    return searchTerm;
  }

  /**
   * Determine which slots to search based on query and filters
   * CRITICAL: Check for dress/gown FIRST before occasion to ensure correct slots
   * ENHANCED: Uses specific accessory types instead of generic "accessories"
   */
  private determineSlotsToSearch(query: string, filters: any): string[] {
    const queryLower = query.toLowerCase();
    const itemType = (filters.itemType || '').toLowerCase();
    const rawGender = filters.gender?.toLowerCase() || 'women';
    // Normalize gender: male -> men, female -> women
    const gender = (rawGender === 'male' || rawGender === 'man') ? 'men' : (rawGender === 'female' || rawGender === 'woman') ? 'women' : rawGender;

    // Specific accessory types by gender (PORTED FROM PYTHON)
    const accessorySlots = gender === 'women'
      ? ['bag', 'jewelry', 'sunglasses', 'belt']  // Women's accessories
      : ['watch', 'belt', 'sunglasses'];           // Men's accessories

    // CRITICAL: Check for dress/gown FIRST - these are complete garments
    // Must check before occasion because "cocktail dress for event" has both
    const isDressRequest =
      queryLower.includes('dress') ||
      queryLower.includes('gown') ||
      itemType.includes('dress') ||
      itemType.includes('gown');

    if (isDressRequest) {
      this.logger.debug('Detected dress request - searching dress, shoes, and specific accessories');
      return ['dress', 'shoes', ...accessorySlots];
    }

    // If specific occasion without dress, search separates
    if (filters.occasion) {
      this.logger.debug(`Occasion "${filters.occasion}" - searching separates with specific accessories`);
      return ['top', 'bottom', 'shoes', 'outerwear', ...accessorySlots];
    }

    // Default: top, bottom, shoes + specific accessories (for complete outfits)
    return ['top', 'bottom', 'shoes', ...accessorySlots];
  }

  /**
   * Format outfit response
   * Maps to Python frontend expected format for compatibility
   */
  private formatOutfitResponse(
    query: string,
    outfits: any[],
    slotProducts: Map<string, Product[]>,
  ): AgentResponse {
    const message = this.generateOutfitMessage(outfits.length);

    return {
      message,
      type: ResponseType.OUTFIT_RECOMMENDATIONS,
      data: {
        outfits: outfits.map((outfit, index) => this.formatOutfit(outfit, index, slotProducts)),
        query,
      },
      suggestedActions: [
        {
          label: 'Save favorite',
          action: 'save_outfit',
        },
        {
          label: 'Modify outfit',
          action: 'modify_outfit',
        },
        {
          label: 'Create more outfits',
          action: 'generate_more',
        },
      ],
    };
  }

  /**
   * Generate natural outfit message
   */
  private generateOutfitMessage(count: number): string {
    if (count === 1) {
      return "I've created a complete outfit for you!";
    } else if (count === 2) {
      return "I've created 2 outfit options for you to choose from!";
    } else {
      return `I've created ${count} outfit combinations just for you!`;
    }
  }

  /**
   * Format single outfit for Python frontend compatibility
   * ENHANCED: Now includes score from deterministic scoring matrix
   * FIXED: Normalize slot names to lowercase for case-insensitive matching
   * CRITICAL FIX: Deduplicate items to ensure ONE item per major slot (Python pattern)
   */
  private formatOutfit(outfit: any, index: number, slotProducts: Map<string, Product[]>): any {
    // DEBUG: Log slotProducts map contents for first outfit
    if (index === 0) {
      this.logger.debug(`=== slotProducts Map Debug ===`);
      this.logger.debug(`Map has ${slotProducts.size} keys: [${Array.from(slotProducts.keys()).join(', ')}]`);
      slotProducts.forEach((products, key) => {
        const firstProduct = products[0];
        this.logger.debug(`  Slot "${key}": ${products.length} products. First: "${firstProduct?.title?.substring(0, 40)}..." (ID: ${firstProduct?.id})`);
      });
    }

    // CRITICAL FIX: Deduplicate items - keep ONLY ONE item per major slot (Python pattern)
    // Major slots (only ONE item allowed): top, bottom, shoes, dress, outerwear
    // Multi-item slots (accessories): bag, jewelry, watch, belt, sunglasses
    const SINGLE_ITEM_SLOTS = ['top', 'bottom', 'shoes', 'dress', 'outerwear', 'one_piece', 'footwear'];
    const seenSlots = new Set<string>();
    const deduplicatedItems = (outfit.items || []).filter((item: any) => {
      const rawSlot = item.slot || item.category || '';
      const normalizedSlot = normalizeSlotName(rawSlot);

      // For single-item slots, only keep the first occurrence
      if (SINGLE_ITEM_SLOTS.includes(normalizedSlot)) {
        if (seenSlots.has(normalizedSlot)) {
          this.logger.warn(`Dedup: Removing duplicate "${normalizedSlot}" item from outfit ${index + 1}`);
          return false;
        }
        seenSlots.add(normalizedSlot);
      }
      return true;
    });

    if (deduplicatedItems.length !== (outfit.items || []).length) {
      this.logger.log(`Outfit ${index + 1}: Deduplicated from ${outfit.items?.length || 0} to ${deduplicatedItems.length} items`);
    }

    // Map items to Python frontend format
    // CRITICAL: Only include items that have REAL products with valid URLs
    const formattedItems = deduplicatedItems.map((item: any) => {
      // Find the actual product from slotProducts
      // CRITICAL FIX: Use centralized slot normalization (handles uppercase, aliases, etc.)
      const rawSlotName = item.slot || item.category || '';
      const slotName = normalizeSlotName(rawSlotName);
      let products = slotProducts.get(slotName) || [];

      // If no products found in normalized slot, try finding across all slots
      if (products.length === 0 && item.productId) {
        const foundAcrossSlots = this.findProductAcrossSlots(item.productId, slotProducts);
        if (foundAcrossSlots.length > 0) {
          products = foundAcrossSlots;
          this.logger.debug(`formatOutfit: Product "${item.productId}" found in different slot than "${slotName}"`);
        }
      }

      // DEBUG: Log what we're looking for
      this.logger.debug(`formatOutfit item: rawSlot="${rawSlotName}" -> normalized="${slotName}" -> found ${products.length} products`);

      // Try multiple matching strategies
      let product = this.findProductMatch(item, products, slotName);

      // CRITICAL: Validate product belongs in the assigned slot (prevents pants in outerwear, etc.)
      if (product && !validateItemForSlot(product, slotName)) {
        const correctSlot = getValidSlotForProduct(product, slotName);
        this.logger.warn(`Product "${product.title?.substring(0, 30)}" doesn't belong in slot "${slotName}", should be "${correctSlot}"`);
        // Try to find a product that actually belongs in this slot
        const validProduct = products.find(p => this.isValidRealProduct(p) && validateItemForSlot(p, slotName));
        if (validProduct) {
          product = validProduct;
          this.logger.debug(`Replaced with valid product "${validProduct.title?.substring(0, 30)}" for slot "${slotName}"`);
        }
      }

      // CRITICAL: Validate the product has a REAL URL (not fabricated by LLM)
      // For wardrobe items, we don't require real URLs since they're user-owned items
      const isWardrobe = item.isFromWardrobe || false;

      if (isWardrobe) {
        // Wardrobe items have different structure - no external URL required
        return {
          slot: slotName,
          category: slotName,
          name: item.name || 'Wardrobe Item',
          price: 'From wardrobe',
          priceValue: 0,
          url: null,
          productUrl: null,
          image_url: item.imageUrl,
          imageUrl: item.imageUrl,
          retailer: 'Your Wardrobe',
          product_id: item.productId,
          brand: item.brand,
          color: item.color,
          selectionReason: item.selectionReason || 'From your wardrobe',
          isFromWardrobe: true,
        };
      }

      if (product && this.isValidRealProduct(product)) {
        return {
          // Python frontend expected fields
          slot: slotName,
          category: slotName,
          name: product.title,
          price: product.price ? `$${product.price.toFixed(2)}` : 'Price unavailable',
          priceValue: product.price || 0,
          url: product.productUrl,
          productUrl: product.productUrl,
          image_url: product.imageUrl,
          imageUrl: product.imageUrl,
          retailer: product.retailer,
          product_id: product.id,
          // Additional fields
          brand: product.brand,
          selectionReason: item.selectionReason,
          isFromWardrobe: false,
        };
      }

      // Fallback: Use first available REAL product from slot if Gemini's ID doesn't match
      this.logger.warn(`Product "${item.productId}" not found in slot "${slotName}", using fallback`);
      const fallbackProduct = products.find(p => this.isValidRealProduct(p));
      if (fallbackProduct) {
        return {
          slot: slotName,
          category: slotName,
          name: fallbackProduct.title,
          price: fallbackProduct.price ? `$${fallbackProduct.price.toFixed(2)}` : 'Price unavailable',
          priceValue: fallbackProduct.price || 0,
          url: fallbackProduct.productUrl,
          productUrl: fallbackProduct.productUrl,
          image_url: fallbackProduct.imageUrl,
          imageUrl: fallbackProduct.imageUrl,
          retailer: fallbackProduct.retailer,
          product_id: fallbackProduct.id,
          brand: fallbackProduct.brand,
          selectionReason: item.selectionReason || 'Selected as best match for your style',
          isFromWardrobe: false,
        };
      }

      // CRITICAL FIX: Return null for items without REAL products - do NOT return fabricated data
      // This prevents fake URLs from appearing in the output
      this.logger.warn(`No REAL product found for slot "${slotName}" - skipping item to prevent fake URLs`);
      return null;
    }).filter((item: any) => item !== null); // Remove null items (those without real products)

    // Calculate total price
    const totalPrice = formattedItems.reduce((sum: number, item: any) => {
      return sum + (item.priceValue || 0);
    }, 0);

    // Count wardrobe vs shopping items for display
    const wardrobeItemCount = formattedItems.filter((i: any) => i.isFromWardrobe).length;
    const shoppingItemCount = formattedItems.filter((i: any) => !i.isFromWardrobe).length;

    return {
      // Python frontend expected fields
      id: `outfit_${index + 1}`,
      outfit_id: index + 1,
      name: outfit.name || `Outfit ${index + 1}`,
      summary: outfit.styleNotes || outfit.occasionFit || 'Stylish outfit for your occasion',
      items: formattedItems,
      total_price: `$${totalPrice.toFixed(2)}`,
      totalPrice: totalPrice,

      // ENHANCED: Score from deterministic scoring matrix (0-10 scale)
      score: outfit.score || 0,
      scoreComponents: outfit.scoreComponents,

      // Reasoning object (matches Python pipeline)
      reasoning: {
        occasion: outfit.occasionFit || 'Appropriate for the occasion',
        weather: outfit.weatherFit || 'Temperature-appropriate fabrics',
        color: outfit.colorHarmony || 'Complementary colors',
        fit: outfit.fitNotes || 'Flattering silhouette',
        trend: outfit.trendAlignment || 'Current fashion trends',
      },

      // Additional fields for enhanced frontend
      style: outfit.style,
      colorScheme: outfit.colorScheme,
      styleNotes: outfit.styleNotes,
      wardrobeSynergy: outfit.wardrobeSynergy,
      occasionFit: outfit.occasionFit,
      tags: outfit.tags || [],

      // WARDROBE INTEGRATION: Strategy and item source tracking
      strategy: outfit.strategy || OutfitStrategy.SHOPPING_ONLY,
      wardrobeUtilization: outfit.wardrobeUtilization || 0,
      shoppingCost: outfit.shoppingCost || totalPrice,
      wardrobeItemCount,
      shoppingItemCount,

      // SAFETY & CULTURAL VALIDATION: Include safety info for frontend
      safetyValidation: outfit.safetyValidation ? {
        isSafe: outfit.safetyValidation.isSafe,
        concerns: outfit.safetyValidation.concerns || [],
        suggestions: outfit.safetyValidation.suggestions || [],
        severity: outfit.safetyValidation.severity || 'low',
      } : undefined,
    };
  }

  /**
   * Find product match using multiple strategies
   * Handles cases where Gemini's productId doesn't exactly match our IDs
   */
  private findProductMatch(item: any, products: Product[], slotName: string): Product | undefined {
    const productId = item.productId || '';

    if (!productId || products.length === 0) {
      return undefined;
    }

    // Strategy 1: Exact ID match
    let match = products.find(p => p.id === productId || p.sourceId === productId);
    if (match) {
      this.logger.debug(`Exact match found for "${productId}" in slot "${slotName}"`);
      return match;
    }

    // Strategy 2: Partial ID match (Gemini might truncate IDs)
    match = products.find(p =>
      (p.id && productId.includes(p.id)) ||
      (p.id && p.id.includes(productId)) ||
      (p.sourceId && typeof p.sourceId === 'string' && p.sourceId.includes(productId))
    );
    if (match) {
      this.logger.debug(`Partial match found for "${productId}" in slot "${slotName}"`);
      return match;
    }

    // Strategy 3: Match by index if productId looks like a number (1, 2, 3...)
    const indexMatch = productId.match(/^(\d+)$/);
    if (indexMatch) {
      const idx = parseInt(indexMatch[1], 10) - 1; // Gemini uses 1-based indexing
      if (idx >= 0 && idx < products.length) {
        this.logger.debug(`Index match (${idx + 1}) found in slot "${slotName}"`);
        return products[idx];
      }
    }

    // Strategy 4: Match by product name substring (for longer IDs that might be names)
    if (productId.length > 10) {
      match = products.find(p =>
        (p.title && p.title.toLowerCase().includes(productId.toLowerCase())) ||
        (p.title && productId.toLowerCase().includes(p.title.toLowerCase()))
      );
      if (match) {
        this.logger.debug(`Name match found for "${productId}" in slot "${slotName}"`);
        return match;
      }
    }

    this.logger.debug(`No match found for productId "${productId}" in slot "${slotName}"`);
    return undefined;
  }

  /**
   * Validate that a product is REAL (not fabricated by LLM)
   *
   * Products from these sources are REAL:
   * - asos_scraper: Real ASOS products from scraper
   * - oxylabs: Real products from Oxylabs API
   * - google_shopping: Real Google Shopping results
   * - searchapi: Real SearchAPI results
   * - shopstyle: Real ShopStyle products
   *
   * Products from these sources are FABRICATED (fake URLs):
   * - claude_web: Claude LLM fabricates product data
   * - Any product with no URL or empty URL
   */
  private isValidRealProduct(product: Product): boolean {
    if (!product) return false;

    // Must have a valid URL
    const url = product.productUrl || (product as any).url || '';
    if (!url || url.trim() === '') {
      this.logger.debug(`Product "${product.title}" rejected: no URL`);
      return false;
    }

    // Must have a valid HTTP(S) URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      this.logger.debug(`Product "${product.title}" rejected: invalid URL scheme`);
      return false;
    }

    // Check if product ID indicates fabricated source (claude_web)
    const productId = (product.id || '').toLowerCase();
    const source = (product.source || '').toLowerCase();

    // CRITICAL: Reject products from claude_web source (fabricated URLs)
    if (productId.includes('claude_web') || productId.includes('claude-web') ||
        source === 'claude_web' || source === 'claude-web') {
      this.logger.debug(`Product "${product.title}" rejected: claude_web source (fabricated)`);
      return false;
    }

    // WHITELIST: Products from known real sources are ALWAYS valid
    // Check this BEFORE fabricated pattern check (real sources may use patterns that look generic)
    const realSources = ['asos_scraper', 'oxylabs', 'google_shopping', 'searchapi', 'shopstyle', 'brave'];
    const sourcePrefix = productId.split('-')[0];

    if (realSources.includes(sourcePrefix) || realSources.includes(source)) {
      this.logger.debug(`Product "${product.title}" accepted: trusted source "${sourcePrefix || source}"`);
      return true;
    }

    // For products without clear source identification, verify URL domain
    const realDomains = [
      'asos.com', 'nordstrom.com', 'amazon.com', 'zappos.com', 'macys.com',
      'bloomingdales.com', 'saksfifthavenue.com', 'shopbop.com', 'revolve.com',
      'net-a-porter.com', 'farfetch.com', 'ssense.com', 'mytheresa.com',
      'zara.com', 'hm.com', 'mango.com', 'uniqlo.com', 'gap.com',
      'urbanoutfitters.com', 'anthropologie.com', 'freepeople.com',
      'target.com', 'walmart.com', 'kohls.com', 'jcpenney.com',
      'dsw.com', 'footlocker.com', 'finishline.com', 'nike.com', 'adidas.com',
      'kendrascott.com', 'baublebar.com', 'mejuri.com',
    ];

    const urlLower = url.toLowerCase();
    const hasRealDomain = realDomains.some(domain => urlLower.includes(domain));

    if (hasRealDomain) {
      this.logger.debug(`Product "${product.title}" accepted: verified domain in URL`);
      return true;
    }

    // Unknown source and unknown domain - reject to be safe
    this.logger.debug(`Product "${product.title}" rejected: unknown source "${sourcePrefix}" and unverified domain`);
    return false;
  }

  /**
   * Response when insufficient products found
   */
  private buildInsufficientProductsResponse(): AgentResponse {
    return {
      message: "I couldn't find enough products to create complete outfits. Let me show you what I found instead!",
      type: ResponseType.TEXT,
      suggestedActions: [
        {
          label: 'Browse individual items',
          action: 'browse_products',
        },
        {
          label: 'Try different search',
          action: 'new_search',
        },
      ],
    };
  }

  /**
   * Response when no outfits generated
   */
  private buildNoOutfitsResponse(): AgentResponse {
    return {
      message: "I found products but couldn't create outfit combinations. Would you like to see the individual items instead?",
      type: ResponseType.TEXT,
      suggestedActions: [
        {
          label: 'Show products',
          action: 'show_products',
        },
        {
          label: 'Adjust preferences',
          action: 'adjust_preferences',
        },
      ],
    };
  }

  /**
   * Replace item in existing outfit
   * ENHANCED: Now properly implements slot-level editing with alternatives
   */
  async replaceOutfitItem(
    outfitId: string,
    slotToReplace: string,
    userContext?: any,
    constraints?: { avoidColors?: string[]; preferColors?: string[]; requirement?: string },
  ): Promise<{ bestReplacement: Product | null; alternatives: Product[] }> {
    this.logger.log(
      `Replacing ${slotToReplace} in outfit ${outfitId}`,
    );

    // Search for replacements with constraints
    const filters: any = {
      itemType: slotToReplace,
      category: slotToReplace,
      gender: userContext?.profile?.gender || userContext?.gender,
    };

    // Apply color constraints
    if (constraints?.preferColors?.length) {
      filters.color = constraints.preferColors;
    }

    // Search for products
    const products = await this.searchSlotWithRetry(slotToReplace, filters, userContext);

    // Filter out avoided colors
    let filteredProducts = products;
    if (constraints?.avoidColors?.length && this.constraintStoreService) {
      const preferences = {
        avoidColors: constraints.avoidColors,
        preferColors: constraints.preferColors || [],
        avoidBrands: [],
        preferBrands: [],
        avoidStyles: [],
        preferStyles: [],
      };
      filteredProducts = this.constraintStoreService.applyConstraintsToProducts(
        products,
        preferences,
      );
    }

    // Return best replacement + alternatives
    return {
      bestReplacement: filteredProducts[0] || null,
      alternatives: filteredProducts.slice(1, 5),
    };
  }

  // ============================================================
  // WEATHER CONSTRAINT METHODS
  // ============================================================

  /**
   * Apply weather constraints to products
   * Filters out inappropriate items and prioritizes weather-appropriate products
   */
  private applyWeatherConstraints(
    slotProducts: Map<string, Product[]>,
    weather: WeatherContext,
  ): Map<string, Product[]> {
    const temp = weather.temperature;
    const tempBand = this.getTemperatureBand(temp);
    const materialPrefs = MATERIAL_BY_TEMPERATURE[tempBand] || { preferred: [], avoid: [] };

    this.logger.debug(
      `Applying weather constraints: ${temp}°F (${tempBand}), condition=${weather.condition}`,
    );

    const filteredProducts = new Map<string, Product[]>();

    for (const [slot, products] of slotProducts) {
      let filtered = products;

      // Apply temperature-based filtering
      filtered = this.filterByTemperature(filtered, temp, slot);

      // Apply weather condition filtering (rain, snow, etc.)
      filtered = this.filterByWeatherCondition(filtered, weather, slot);

      // Apply material preferences (prioritize, don't exclude completely)
      filtered = this.sortByMaterialPreference(filtered, materialPrefs);

      // If we filtered out too many products, relax constraints
      if (filtered.length < 2 && products.length >= 2) {
        this.logger.debug(`Slot "${slot}": Weather filter too strict, relaxing constraints`);
        filtered = products;
      }

      filteredProducts.set(slot, filtered);
    }

    return filteredProducts;
  }

  /**
   * Get temperature band from Fahrenheit temperature
   */
  private getTemperatureBand(temp: number): string {
    if (temp <= TEMPERATURE_RANGES.cold.max) return 'cold';
    if (temp <= TEMPERATURE_RANGES.cool.max) return 'cool';
    if (temp <= TEMPERATURE_RANGES.mild.max) return 'mild';
    if (temp <= TEMPERATURE_RANGES.warm.max) return 'warm';
    return 'hot';
  }

  /**
   * Filter products by temperature appropriateness
   */
  private filterByTemperature(
    products: Product[],
    temp: number,
    slot: string,
  ): Product[] {
    return products.filter((product) => {
      const title = (product.title || '').toLowerCase();
      const description = (product.description || '').toLowerCase();
      const combined = `${title} ${description}`;

      // Cold weather (below 40°F)
      if (temp <= 40) {
        // Reject sleeveless/thin items for tops
        if (slot === 'top' || slot === 'dress') {
          if (combined.includes('sleeveless') ||
              combined.includes('tank') ||
              combined.includes('crop') ||
              combined.includes('strapless')) {
            return false;
          }
        }

        // Reject open-toe for shoes
        if (slot === 'shoes') {
          if (combined.includes('sandal') ||
              combined.includes('flip flop') ||
              combined.includes('open toe')) {
            return false;
          }
        }
      }

      // Hot weather (above 85°F)
      if (temp >= 85) {
        // Reject heavy items
        if (combined.includes('wool') ||
            combined.includes('fleece') ||
            combined.includes('heavy') ||
            combined.includes('fur') ||
            combined.includes('down jacket')) {
          return false;
        }

        // Reject boots in summer (unless rain boots)
        if (slot === 'shoes') {
          if (combined.includes('boot') && !combined.includes('rain')) {
            return false;
          }
        }
      }

      return true;
    });
  }

  /**
   * Filter products by weather condition (rain, snow, etc.)
   */
  private filterByWeatherCondition(
    products: Product[],
    weather: WeatherContext,
    slot: string,
  ): Product[] {
    const condition = weather.condition;

    // No filtering for normal conditions
    if (!['rainy', 'snowy', 'stormy'].includes(condition)) {
      return products;
    }

    return products.filter((product) => {
      const title = (product.title || '').toLowerCase();
      const description = (product.description || '').toLowerCase();
      const combined = `${title} ${description}`;

      // Rainy conditions
      if (condition === 'rainy' || condition === 'stormy') {
        // For shoes, prefer waterproof/closed-toe
        if (slot === 'shoes') {
          // Don't exclude, but deprioritize open-toe
          if (combined.includes('suede')) {
            return false; // Suede gets damaged in rain
          }
        }

        // For outerwear, prefer water-resistant
        if (slot === 'outerwear') {
          // Don't exclude non-waterproof, but prefer rain-friendly
        }
      }

      // Snowy conditions
      if (condition === 'snowy') {
        // Reject high heels in snow
        if (slot === 'shoes') {
          if (combined.includes('stiletto') ||
              combined.includes('high heel')) {
            return false;
          }
        }
      }

      return true;
    });
  }

  /**
   * Sort products by material preference (weather-appropriate materials first)
   */
  private sortByMaterialPreference(
    products: Product[],
    materialPrefs: { preferred: string[]; avoid: string[] },
  ): Product[] {
    return [...products].sort((a, b) => {
      const aText = `${a.title || ''} ${a.description || ''}`.toLowerCase();
      const bText = `${b.title || ''} ${b.description || ''}`.toLowerCase();

      // Check for preferred materials
      const aHasPreferred = materialPrefs.preferred.some(m => aText.includes(m));
      const bHasPreferred = materialPrefs.preferred.some(m => bText.includes(m));

      // Check for materials to avoid
      const aHasAvoid = materialPrefs.avoid.some(m => aText.includes(m));
      const bHasAvoid = materialPrefs.avoid.some(m => bText.includes(m));

      // Score: +1 for preferred, -1 for avoid
      const aScore = (aHasPreferred ? 1 : 0) - (aHasAvoid ? 1 : 0);
      const bScore = (bHasPreferred ? 1 : 0) - (bHasAvoid ? 1 : 0);

      return bScore - aScore; // Higher score first
    });
  }

  // ============================================================
  // WARDROBE INTEGRATION METHODS
  // ============================================================

  /**
   * Fetch user's wardrobe items
   */
  private async fetchWardrobeItems(userId: string): Promise<WardrobeItem[]> {
    if (!this.wardrobeService) {
      this.logger.debug('WardrobeService not available, skipping wardrobe fetch');
      return [];
    }

    try {
      const result = await this.wardrobeService.getUserItems(userId, {});
      const items = Array.isArray(result) ? result : (result.items || []);

      return items.map((item: any) => ({
        id: item._id?.toString() || item.id,
        name: item.name || item.title || 'Wardrobe Item',
        category: item.category?.toLowerCase() || 'other',
        subcategory: item.subcategory,
        color: item.dominantColor || item.color,
        brand: item.brand,
        imageUrl: item.imageUrl || item.processedImageUrl,
        occasions: item.occasion || [],
        style: item.style || [],
        isFromWardrobe: true as const,
      }));
    } catch (error) {
      this.logger.warn(`Failed to fetch wardrobe for user ${userId}: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Map wardrobe category to slot
   */
  private wardrobeCategoryToSlot(category: string): string {
    const categoryLower = category.toLowerCase();

    // Direct mappings
    const categoryToSlot: Record<string, string> = {
      // Tops
      tops: 'top',
      top: 'top',
      shirts: 'top',
      shirt: 'top',
      blouses: 'top',
      blouse: 'top',
      sweaters: 'top',
      sweater: 'top',
      tshirts: 'top',
      't-shirts': 'top',
      tanks: 'top',

      // Bottoms
      bottoms: 'bottom',
      bottom: 'bottom',
      pants: 'bottom',
      jeans: 'bottom',
      trousers: 'bottom',
      skirts: 'bottom',
      skirt: 'bottom',
      shorts: 'bottom',

      // Dresses
      dresses: 'dress',
      dress: 'dress',
      jumpsuits: 'dress',
      jumpsuit: 'dress',
      rompers: 'dress',

      // Outerwear
      outerwear: 'outerwear',
      jackets: 'outerwear',
      jacket: 'outerwear',
      coats: 'outerwear',
      coat: 'outerwear',
      blazers: 'outerwear',
      blazer: 'outerwear',

      // Shoes
      shoes: 'shoes',
      footwear: 'shoes',
      sneakers: 'shoes',
      heels: 'shoes',
      boots: 'shoes',
      sandals: 'shoes',
      loafers: 'shoes',

      // Accessories
      accessories: 'accessories',
      bags: 'accessories',
      bag: 'accessories',
      jewelry: 'accessories',
      watches: 'accessories',
      watch: 'accessories',
      belts: 'accessories',
      belt: 'accessories',
      scarves: 'accessories',
      scarf: 'accessories',
      sunglasses: 'accessories',
      hats: 'accessories',
      hat: 'accessories',
    };

    return categoryToSlot[categoryLower] || 'accessories';
  }

  /**
   * Find wardrobe items that match a specific slot
   */
  private findWardrobeItemsForSlot(
    wardrobeItems: WardrobeItem[],
    slot: string,
    filters?: any,
  ): WardrobeItem[] {
    const matchingItems = wardrobeItems.filter((item) => {
      // Check category matches slot
      const itemSlot = this.wardrobeCategoryToSlot(item.category);
      if (itemSlot !== slot) return false;

      // Apply color filter if specified
      if (filters?.color?.length && item.color) {
        const itemColor = item.color.toLowerCase();
        const filterColors = filters.color.map((c: string) => c.toLowerCase());
        if (!filterColors.some((fc: string) => itemColor.includes(fc))) {
          return false;
        }
      }

      // Apply occasion filter if specified
      if (filters?.occasion && item.occasions?.length) {
        const filterOccasion = filters.occasion.toLowerCase();
        if (!item.occasions.some((o) => o.toLowerCase().includes(filterOccasion))) {
          return false;
        }
      }

      return true;
    });

    return matchingItems;
  }

  /**
   * Analyze wardrobe coverage for required slots
   */
  private analyzeWardrobeCoverage(
    wardrobeItems: WardrobeItem[],
    requiredSlots: string[],
    filters?: any,
  ): {
    coveredSlots: Map<string, WardrobeItem[]>;
    missingSlots: string[];
    canBuildWardrobeOnlyOutfit: boolean;
  } {
    const coveredSlots = new Map<string, WardrobeItem[]>();
    const missingSlots: string[] = [];

    // Core slots that MUST be filled for a complete outfit
    const coreSlots = ['top', 'bottom', 'shoes'];

    for (const slot of requiredSlots) {
      const items = this.findWardrobeItemsForSlot(wardrobeItems, slot, filters);
      if (items.length > 0) {
        coveredSlots.set(slot, items);
      } else {
        missingSlots.push(slot);
      }
    }

    // Check if we have enough core items for a wardrobe-only outfit
    // Need either (top + bottom + shoes) OR (dress + shoes)
    const hasTop = coveredSlots.has('top') || coveredSlots.has('dress');
    const hasBottom = coveredSlots.has('bottom') || coveredSlots.has('dress');
    const hasShoes = coveredSlots.has('shoes');

    const canBuildWardrobeOnlyOutfit = hasTop && hasBottom && hasShoes;

    this.logger.debug(
      `Wardrobe analysis: covered=${[...coveredSlots.keys()].join(',')}, missing=${missingSlots.join(',')}, canBuildOnly=${canBuildWardrobeOnlyOutfit}`,
    );

    return { coveredSlots, missingSlots, canBuildWardrobeOnlyOutfit };
  }

  /**
   * Generate outfit using ONLY wardrobe items
   */
  private async generateWardrobeOnlyOutfit(
    wardrobeItems: WardrobeItem[],
    filters: any,
    gender: string,
    outfitNumber: number,
  ): Promise<any | null> {
    const slotsToFill = this.determineSlotsToSearch('', filters);
    const analysis = this.analyzeWardrobeCoverage(wardrobeItems, slotsToFill, filters);

    if (!analysis.canBuildWardrobeOnlyOutfit) {
      this.logger.debug('Cannot build wardrobe-only outfit - insufficient items');
      return null;
    }

    // Build outfit from wardrobe items
    const outfitItems: any[] = [];

    // Core items - prioritize dress if available (for women), otherwise top + bottom
    if (analysis.coveredSlots.has('dress') && gender === 'women') {
      const dresses = analysis.coveredSlots.get('dress') || [];
      const selectedDress = dresses[Math.min(outfitNumber - 1, dresses.length - 1)];
      if (selectedDress) {
        outfitItems.push({
          slot: 'dress',
          productId: selectedDress.id,
          name: selectedDress.name,
          imageUrl: selectedDress.imageUrl,
          color: selectedDress.color,
          brand: selectedDress.brand,
          isFromWardrobe: true,
          selectionReason: 'From your wardrobe',
        });
      }
    } else {
      // Add top
      const tops = analysis.coveredSlots.get('top') || [];
      if (tops.length > 0) {
        const selectedTop = tops[Math.min(outfitNumber - 1, tops.length - 1)];
        outfitItems.push({
          slot: 'top',
          productId: selectedTop.id,
          name: selectedTop.name,
          imageUrl: selectedTop.imageUrl,
          color: selectedTop.color,
          brand: selectedTop.brand,
          isFromWardrobe: true,
          selectionReason: 'From your wardrobe',
        });
      }

      // Add bottom
      const bottoms = analysis.coveredSlots.get('bottom') || [];
      if (bottoms.length > 0) {
        const selectedBottom = bottoms[Math.min(outfitNumber - 1, bottoms.length - 1)];
        outfitItems.push({
          slot: 'bottom',
          productId: selectedBottom.id,
          name: selectedBottom.name,
          imageUrl: selectedBottom.imageUrl,
          color: selectedBottom.color,
          brand: selectedBottom.brand,
          isFromWardrobe: true,
          selectionReason: 'From your wardrobe',
        });
      }
    }

    // Add shoes
    const shoes = analysis.coveredSlots.get('shoes') || [];
    if (shoes.length > 0) {
      const selectedShoes = shoes[Math.min(outfitNumber - 1, shoes.length - 1)];
      outfitItems.push({
        slot: 'shoes',
        productId: selectedShoes.id,
        name: selectedShoes.name,
        imageUrl: selectedShoes.imageUrl,
        color: selectedShoes.color,
        brand: selectedShoes.brand,
        isFromWardrobe: true,
        selectionReason: 'From your wardrobe',
      });
    }

    // Add outerwear if available
    const outerwear = analysis.coveredSlots.get('outerwear') || [];
    if (outerwear.length > 0) {
      const selectedOuterwear = outerwear[Math.min(outfitNumber - 1, outerwear.length - 1)];
      outfitItems.push({
        slot: 'outerwear',
        productId: selectedOuterwear.id,
        name: selectedOuterwear.name,
        imageUrl: selectedOuterwear.imageUrl,
        color: selectedOuterwear.color,
        brand: selectedOuterwear.brand,
        isFromWardrobe: true,
        selectionReason: 'From your wardrobe',
      });
    }

    // Add accessories if available
    const accessories = analysis.coveredSlots.get('accessories') || [];
    const accessoriesToAdd = Math.min(2, accessories.length);
    for (let i = 0; i < accessoriesToAdd; i++) {
      outfitItems.push({
        slot: 'accessory',
        productId: accessories[i].id,
        name: accessories[i].name,
        imageUrl: accessories[i].imageUrl,
        color: accessories[i].color,
        brand: accessories[i].brand,
        isFromWardrobe: true,
        selectionReason: 'From your wardrobe',
      });
    }

    if (outfitItems.length < 3) {
      this.logger.debug('Wardrobe-only outfit has too few items');
      return null;
    }

    return {
      name: `Look ${outfitNumber} (From Your Wardrobe)`,
      summary: 'A complete look created from your existing wardrobe items.',
      items: outfitItems,
      strategy: OutfitStrategy.WARDROBE_ONLY,
      wardrobeUtilization: 1.0,
      shoppingCost: 0,
    };
  }

  /**
   * Generate hybrid outfit (wardrobe items + shopping for gaps)
   */
  private async generateHybridOutfit(
    wardrobeItems: WardrobeItem[],
    shoppingProducts: Map<string, Product[]>,
    filters: any,
    gender: string,
    userContext: any,
  ): Promise<any> {
    const slotsToFill = this.determineSlotsToSearch('', filters);
    const analysis = this.analyzeWardrobeCoverage(wardrobeItems, slotsToFill, filters);

    const outfitItems: any[] = [];
    let wardrobeItemCount = 0;
    let shoppingItemCount = 0;
    let totalShoppingCost = 0;

    for (const slot of slotsToFill) {
      // Prefer wardrobe items
      if (analysis.coveredSlots.has(slot)) {
        const wardrobeOptions = analysis.coveredSlots.get(slot) || [];
        if (wardrobeOptions.length > 0) {
          const selected = wardrobeOptions[0];
          outfitItems.push({
            slot,
            productId: selected.id,
            name: selected.name,
            imageUrl: selected.imageUrl,
            color: selected.color,
            brand: selected.brand,
            isFromWardrobe: true,
            selectionReason: 'From your wardrobe',
          });
          wardrobeItemCount++;
          continue;
        }
      }

      // Fall back to shopping
      const shoppingOptions = shoppingProducts.get(slot) || [];
      if (shoppingOptions.length > 0) {
        const selected = shoppingOptions[0];
        outfitItems.push({
          slot,
          productId: selected.id || selected.sourceId,
          name: selected.title,
          imageUrl: selected.imageUrl,
          color: selected.color,
          brand: selected.brand,
          price: selected.price,
          productUrl: selected.productUrl,
          retailer: selected.retailer,
          isFromWardrobe: false,
          selectionReason: 'Suggested to complete your outfit',
        });
        shoppingItemCount++;
        if (selected.price) {
          totalShoppingCost += selected.price;
        }
      }
    }

    const totalItems = wardrobeItemCount + shoppingItemCount;
    const wardrobeUtilization = totalItems > 0 ? wardrobeItemCount / totalItems : 0;

    return {
      name: 'Look 2 (Wardrobe + New Finds)',
      summary: `A styled look using ${wardrobeItemCount} pieces from your wardrobe and ${shoppingItemCount} new items.`,
      items: outfitItems,
      strategy: OutfitStrategy.HYBRID,
      wardrobeUtilization,
      shoppingCost: totalShoppingCost,
    };
  }

  /**
   * Generate shopping-only outfit (no wardrobe items)
   */
  private async generateShoppingOnlyOutfit(
    shoppingProducts: Map<string, Product[]>,
    filters: any,
    gender: string,
    userContext: any,
  ): Promise<any> {
    const outfitItems: any[] = [];
    let totalCost = 0;

    const slotsToFill = this.determineSlotsToSearch('', filters);

    for (const slot of slotsToFill) {
      const products = shoppingProducts.get(slot) || [];
      if (products.length > 0) {
        // For shopping-only, pick different items than hybrid to provide variety
        const productIndex = Math.min(1, products.length - 1);
        const selected = products[productIndex];

        outfitItems.push({
          slot,
          productId: selected.id || selected.sourceId,
          name: selected.title,
          imageUrl: selected.imageUrl,
          color: selected.color,
          brand: selected.brand,
          price: selected.price,
          productUrl: selected.productUrl,
          retailer: selected.retailer,
          isFromWardrobe: false,
          selectionReason: 'New shopping suggestion',
        });

        if (selected.price) {
          totalCost += selected.price;
        }
      }
    }

    return {
      name: 'Look 3 (Fresh Style)',
      summary: 'A complete new look to refresh your wardrobe.',
      items: outfitItems,
      strategy: OutfitStrategy.SHOPPING_ONLY,
      wardrobeUtilization: 0,
      shoppingCost: totalCost,
    };
  }

  /**
   * Generate 3 outfits using the 3-tier strategy:
   * 1. Wardrobe-only (if possible)
   * 2. Hybrid (wardrobe + shopping)
   * 3. Shopping-only
   * If wardrobe is empty, all 3 are shopping-based
   */
  async generateOutfitsWithWardrobeStrategy(
    message: string,
    filters: any,
    userContext: any,
    userId: string,
  ): Promise<{
    outfits: any[];
    slotProducts: Map<string, Product[]>;
    hasWardrobe: boolean;
  }> {
    const gender = this.normalizeGender(filters?.gender || userContext?.profile?.gender || 'women');
    const minItems = gender === 'women' ? this.MIN_ITEMS_WOMEN : this.MIN_ITEMS_MEN;

    // Step 1: Fetch wardrobe items
    const wardrobeItems = await this.fetchWardrobeItems(userId);
    const hasWardrobe = wardrobeItems.length > 0;

    this.logger.log(
      `Wardrobe strategy: ${wardrobeItems.length} wardrobe items found for user ${userId}`,
    );

    // Step 2: Search for shopping products (always needed for fallback)
    const slotProducts = await this.searchProductsBySlot(message, filters, userContext);

    // Step 3: Generate outfits based on strategy
    const outfits: any[] = [];

    if (hasWardrobe) {
      // Strategy 1: Wardrobe-only outfit
      const wardrobeOnlyOutfit = await this.generateWardrobeOnlyOutfit(
        wardrobeItems,
        filters,
        gender,
        1,
      );

      if (wardrobeOnlyOutfit) {
        outfits.push(wardrobeOnlyOutfit);
      } else {
        // If can't build wardrobe-only, use hybrid instead
        this.logger.debug('Could not build wardrobe-only outfit, using hybrid instead');
      }

      // Strategy 2: Hybrid outfit
      const hybridOutfit = await this.generateHybridOutfit(
        wardrobeItems,
        slotProducts,
        filters,
        gender,
        userContext,
      );
      outfits.push(hybridOutfit);

      // Strategy 3: Shopping-only outfit
      const shoppingOutfit = await this.generateShoppingOnlyOutfit(
        slotProducts,
        filters,
        gender,
        userContext,
      );
      outfits.push(shoppingOutfit);
    } else {
      // No wardrobe - generate 3 shopping outfits using LLM
      this.logger.log('No wardrobe items - generating all shopping outfits');

      // Use existing LLM-based outfit generation for all 3 outfits
      let llmOutfits: any[] = [];

      try {
        llmOutfits = await this.claudeService.generateOutfitRecommendations(
          message,
          userContext,
          slotProducts,
          filters,
        );
      } catch (claudeError: any) {
        this.logger.warn(`Claude failed: ${claudeError.message}, falling back to Gemini`);
        try {
          llmOutfits = await this.geminiService.generateOutfitRecommendations(
            message,
            userContext,
            slotProducts,
            filters,
          );
        } catch (geminiError: any) {
          this.logger.error(`Both LLMs failed: ${geminiError.message}`);
        }
      }

      // Add strategy metadata to LLM outfits
      for (let i = 0; i < llmOutfits.length; i++) {
        outfits.push({
          ...llmOutfits[i],
          name: llmOutfits[i].name || `Look ${i + 1}`,
          strategy: OutfitStrategy.SHOPPING_ONLY,
          wardrobeUtilization: 0,
        });
      }
    }

    // Ensure we have 3 outfits
    while (outfits.length < 3) {
      const shoppingOutfit = await this.generateShoppingOnlyOutfit(
        slotProducts,
        filters,
        gender,
        userContext,
      );
      shoppingOutfit.name = `Look ${outfits.length + 1}`;
      outfits.push(shoppingOutfit);
    }

    return {
      outfits: outfits.slice(0, 3),
      slotProducts,
      hasWardrobe,
    };
  }

  /**
   * Normalize gender string
   */
  private normalizeGender(gender: string): string {
    const rawGender = (gender || 'women').toLowerCase();
    return rawGender === 'male' || rawGender === 'man'
      ? 'men'
      : rawGender === 'female' || rawGender === 'woman'
        ? 'women'
        : rawGender;
  }
}
