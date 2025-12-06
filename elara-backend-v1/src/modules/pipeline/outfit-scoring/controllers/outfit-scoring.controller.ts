import {
  Controller,
  Get,
  Post,
  Body,
  Request,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  OutfitCompatibilityService,
  WardrobeItemInfo,
} from '../outfit-compatibility.service';
import {
  OutfitReasoningService,
  OutfitGenerationRequest,
} from '../services/outfit-reasoning.service';
import {
  ContextAwareScoringService,
  ScoringContext,
} from '../services/context-aware-scoring.service';
import { WardrobeCategory } from '../../../wardrobe/domain/enums/wardrobe-category.enum';
import { Pattern } from '../../../wardrobe/domain/enums/pattern.enum';
import { Occasion } from '../../../wardrobe/domain/enums/occasion.enum';
import { Season } from '../../../wardrobe/domain/enums/season.enum';

/**
 * Outfit Scoring Controller
 *
 * REST API endpoints for outfit compatibility scoring and generation.
 *
 * Endpoints:
 * - POST /outfit-scoring/score - Score an outfit combination
 * - POST /outfit-scoring/score-with-context - Score with full context awareness
 * - POST /outfit-scoring/suggestions - Get completion suggestions
 * - POST /outfit-scoring/best-matches - Find best matching items
 * - POST /outfit-scoring/generate - Generate context-aware outfits
 * - GET /outfit-scoring/weights - Get scoring weights
 */

// DTOs
interface WardrobeItemDto {
  id: string;
  category: WardrobeCategory;
  subcategory?: string;
  dominantColor?: string;
  colorPalette?: string[];
  pattern?: Pattern;
  style?: string[];
  occasion?: Occasion[];
  season?: Season[];
  material?: string;
  embedding?: number[];
}

interface ScoreOutfitDto {
  items: WardrobeItemDto[];
}

interface GetSuggestionsDto {
  items: WardrobeItemDto[];
}

interface FindBestMatchesDto {
  currentItems: WardrobeItemDto[];
  candidateItems: WardrobeItemDto[];
  limit?: number;
}

interface GenerateOutfitsDto {
  userId: string;
  query: string;
  filters?: {
    occasion?: string;
    location?: string;
    datetime?: string;
    color?: string[];
    style?: string;
    priceRange?: {
      min?: number;
      max?: number;
    };
    brands?: string[];
  };
  wardrobeItemIds?: string[];
  excludeProductIds?: string[];
  count?: number;
}

interface ScoreWithContextDto {
  items: WardrobeItemDto[];
  context: {
    weather?: {
      temperature: number;
      feelsLike: number;
      condition: string;
      humidity: number;
      windSpeed: number;
      precipitation: number;
      uvIndex: number;
      location: string;
    };
    event?: {
      occasion: string;
      formality: string;
      settingType: string;
      duration?: number;
      activityLevel: string;
      socialContext?: string;
      dressCode?: string;
    };
    constraints: {
      temperatureRange: string;
      needsOuterwear: boolean;
      needsRainProtection: boolean;
      needsSunProtection: boolean;
      preferredMaterials: string[];
      avoidMaterials: string[];
      minCoverage: string;
      suggestLayering: boolean;
      layerCount: number;
      seasonalColors: string[];
    };
    trends?: Array<{
      name: string;
      category: string;
      season: string;
      relevanceScore: number;
      description?: string;
    }>;
    userPreferences: {
      colorPreferences: string[];
      avoidColors: string[];
      primaryStyle: string;
      selectedStyles: string[];
      modestDressing?: boolean;
    };
  };
}

@Controller('pipeline/outfit-scoring')
export class OutfitScoringController {
  private readonly logger = new Logger(OutfitScoringController.name);

  constructor(
    private outfitCompatibilityService: OutfitCompatibilityService,
    private outfitReasoningService: OutfitReasoningService,
    private contextAwareScoringService: ContextAwareScoringService,
  ) {}

  /**
   * Score an outfit combination
   *
   * Returns a detailed compatibility score including:
   * - Overall score (0-1)
   * - Component scores (color harmony, pattern balance, etc.)
   * - Issues and suggestions
   * - Confidence level
   */
  @Post('score')
  async scoreOutfit(@Request() req: any, @Body() dto: ScoreOutfitDto) {
    const items = this.convertToWardrobeItems(dto.items);

    this.logger.debug(`Scoring outfit with ${items.length} items`);

    const score = await this.outfitCompatibilityService.scoreOutfit(items);

    return {
      success: true,
      data: {
        score: score.overall,
        components: score.components,
        issues: score.issues,
        suggestions: score.suggestions,
        confidence: score.confidence,
        interpretation: this.interpretScore(score.overall),
      },
    };
  }

  /**
   * Get suggestions for completing an outfit
   *
   * Returns missing pieces needed to complete the outfit
   * with preferred attributes based on existing items.
   */
  @Post('suggestions')
  async getSuggestions(@Body() dto: GetSuggestionsDto) {
    const items = this.convertToWardrobeItems(dto.items);

    const suggestions = this.outfitCompatibilityService.getSuggestions(items);

    return {
      success: true,
      data: suggestions.map((s) => ({
        missingCategory: s.missingCategory,
        reason: s.reason,
        preferredAttributes: s.preferredAttributes,
      })),
    };
  }

  /**
   * Find best matching items for an outfit
   *
   * Given current outfit items and candidate items,
   * returns the candidates ranked by compatibility.
   */
  @Post('best-matches')
  async findBestMatches(@Body() dto: FindBestMatchesDto) {
    const currentItems = this.convertToWardrobeItems(dto.currentItems);
    const candidateItems = this.convertToWardrobeItems(dto.candidateItems);
    const limit = dto.limit || 5;

    this.logger.debug(
      `Finding best matches: ${currentItems.length} current, ${candidateItems.length} candidates`,
    );

    const matches = await this.outfitCompatibilityService.findBestMatches(
      currentItems,
      candidateItems,
      limit,
    );

    return {
      success: true,
      data: matches.map((m) => ({
        itemId: m.item.id,
        category: m.item.category,
        score: m.score,
        reasons: m.reasons,
      })),
    };
  }

  /**
   * Get scoring weights (informational)
   */
  @Get('weights')
  async getWeights() {
    return {
      success: true,
      data: {
        colorHarmony: { weight: 0.20, description: 'How well colors work together' },
        patternBalance: { weight: 0.15, description: 'Pattern mixing compatibility' },
        categoryCompleteness: { weight: 0.20, description: 'Has required pieces (top/bottom)' },
        styleCohesion: { weight: 0.15, description: 'Style consistency across items' },
        occasionMatch: { weight: 0.10, description: 'Items suit same occasions' },
        seasonMatch: { weight: 0.10, description: 'Items suit same seasons' },
        semanticSimilarity: { weight: 0.10, description: 'AI-based compatibility' },
      },
    };
  }

  /**
   * Generate context-aware outfit recommendations
   *
   * Uses the full context (weather, event, user preferences, trends)
   * to generate personalized outfit combinations.
   */
  @Post('generate')
  async generateOutfits(@Body() dto: GenerateOutfitsDto) {
    try {
      this.logger.debug(`Generating outfits for user ${dto.userId}: "${dto.query}"`);

      const result = await this.outfitReasoningService.generateOutfits({
        userId: dto.userId,
        query: dto.query,
        filters: dto.filters ? {
          occasion: dto.filters.occasion,
          location: dto.filters.location,
          datetime: dto.filters.datetime ? new Date(dto.filters.datetime) : undefined,
          color: dto.filters.color,
          style: dto.filters.style,
          priceRange: dto.filters.priceRange,
          brands: dto.filters.brands,
        } : undefined,
        wardrobeItemIds: dto.wardrobeItemIds,
        excludeProductIds: dto.excludeProductIds,
        count: dto.count || 3,
      });

      return {
        success: true,
        data: {
          outfits: result.outfits.map(outfit => ({
            id: outfit.id,
            name: outfit.name,
            style: outfit.style,
            items: outfit.items.map(item => ({
              slot: item.slot,
              productId: item.productId,
              product: item.product ? {
                id: item.product.id,
                title: item.product.title,
                price: item.product.price,
                imageUrl: item.product.imageUrl,
                productUrl: item.product.productUrl,
                retailer: item.product.retailer,
                brand: item.product.brand,
              } : undefined,
              wardrobeItem: item.wardrobeItem ? {
                id: item.wardrobeItem.id,
                name: item.wardrobeItem.name,
                category: item.wardrobeItem.category,
                color: item.wardrobeItem.color,
                imageUrl: item.wardrobeItem.imageUrl,
              } : undefined,
              selectionReason: item.selectionReason,
              isFromWardrobe: item.isFromWardrobe,
            })),
            totalPrice: outfit.totalPrice,
            colorScheme: outfit.colorScheme,
            styleNotes: outfit.styleNotes,
            wardrobeSynergy: outfit.wardrobeSynergy,
            occasionFit: outfit.occasionFit,
            weatherFit: outfit.weatherFit,
            trendAlignment: outfit.trendAlignment,
            score: outfit.score,
            constraintValidation: outfit.constraintValidation,
          })),
          context: {
            weather: result.context.weather,
            event: result.context.event,
            constraints: result.context.constraints,
            trends: result.context.appliedTrends,
          },
          metadata: result.metadata,
        },
      };
    } catch (error) {
      this.logger.error(`Outfit generation failed: ${(error as Error).message}`);
      throw new HttpException(
        {
          success: false,
          error: 'Failed to generate outfits',
          message: (error as Error).message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Score an outfit with full context awareness
   *
   * Includes weather, event, trend, constraint, and preference factors
   * in addition to base compatibility scoring.
   */
  @Post('score-with-context')
  async scoreWithContext(@Body() dto: ScoreWithContextDto) {
    try {
      const items = this.convertToWardrobeItems(dto.items);

      const context: ScoringContext = {
        weather: dto.context.weather as any,
        event: dto.context.event as any,
        constraints: dto.context.constraints as any,
        trends: dto.context.trends as any || [],
        userPreferences: dto.context.userPreferences,
      };

      this.logger.debug(`Scoring outfit with context: ${items.length} items`);

      const score = await this.contextAwareScoringService.scoreWithContext(items, context);

      return {
        success: true,
        data: {
          // Overall scores
          finalScore: score.finalScore,
          overallContextScore: score.overallContextScore,
          baseScore: score.overall,

          // Base compatibility components
          baseComponents: score.components,

          // Context-specific factors
          contextFactors: score.contextFactors,

          // Issues and suggestions
          baseIssues: score.issues.filter(i => !score.contextIssues.includes(i)),
          contextIssues: score.contextIssues,
          suggestions: score.suggestions,
          contextSuggestions: score.contextSuggestions,

          // Confidence
          confidence: score.confidence,

          // Human-readable interpretation
          interpretation: this.interpretContextScore(score.finalScore),

          // Detailed explanation
          explanation: this.contextAwareScoringService.getScoreExplanation(score),
        },
      };
    } catch (error) {
      this.logger.error(`Context-aware scoring failed: ${(error as Error).message}`);
      throw new HttpException(
        {
          success: false,
          error: 'Failed to score outfit',
          message: (error as Error).message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Compare multiple outfits with context
   */
  @Post('compare')
  async compareOutfits(@Body() dto: { outfits: WardrobeItemDto[][]; context: ScoreWithContextDto['context'] }) {
    try {
      const outfitItems = dto.outfits.map(items => this.convertToWardrobeItems(items));

      const context: ScoringContext = {
        weather: dto.context.weather as any,
        event: dto.context.event as any,
        constraints: dto.context.constraints as any,
        trends: dto.context.trends as any || [],
        userPreferences: dto.context.userPreferences,
      };

      const comparisons = await this.contextAwareScoringService.compareOutfits(outfitItems, context);

      return {
        success: true,
        data: comparisons.map(c => ({
          index: c.index,
          rank: c.rank,
          finalScore: c.score.finalScore,
          contextScore: c.score.overallContextScore,
          baseScore: c.score.overall,
          issues: c.score.issues,
          suggestions: c.score.suggestions,
        })),
      };
    } catch (error) {
      this.logger.error(`Outfit comparison failed: ${(error as Error).message}`);
      throw new HttpException(
        {
          success: false,
          error: 'Failed to compare outfits',
          message: (error as Error).message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Convert DTOs to WardrobeItemInfo
   */
  private convertToWardrobeItems(items: WardrobeItemDto[]): WardrobeItemInfo[] {
    return items.map((item) => ({
      id: item.id,
      category: item.category,
      subcategory: item.subcategory,
      dominantColor: item.dominantColor,
      colorPalette: item.colorPalette,
      pattern: item.pattern,
      style: item.style,
      occasion: item.occasion,
      season: item.season,
      material: item.material,
      embedding: item.embedding,
    }));
  }

  /**
   * Interpret score into human-readable rating
   */
  private interpretScore(score: number): {
    rating: string;
    emoji: string;
    message: string;
  } {
    if (score >= 0.85) {
      return {
        rating: 'Excellent',
        emoji: '✨',
        message: 'This outfit combination works beautifully together!',
      };
    }
    if (score >= 0.70) {
      return {
        rating: 'Good',
        emoji: '👍',
        message: 'Solid outfit choice with good coordination.',
      };
    }
    if (score >= 0.55) {
      return {
        rating: 'Fair',
        emoji: '🤔',
        message: 'Decent outfit, but could use some adjustments.',
      };
    }
    if (score >= 0.40) {
      return {
        rating: 'Needs Work',
        emoji: '⚠️',
        message: 'Consider the suggestions to improve this outfit.',
      };
    }
    return {
      rating: 'Incomplete',
      emoji: '❌',
      message: 'This outfit needs more items or better coordination.',
    };
  }

  /**
   * Interpret context-aware score into human-readable rating
   */
  private interpretContextScore(score: number): {
    rating: string;
    emoji: string;
    message: string;
  } {
    if (score >= 0.85) {
      return {
        rating: 'Perfect Match',
        emoji: '🌟',
        message: 'This outfit is perfectly suited for the occasion, weather, and your style!',
      };
    }
    if (score >= 0.75) {
      return {
        rating: 'Great Choice',
        emoji: '✨',
        message: 'Excellent outfit that fits well with the context and your preferences.',
      };
    }
    if (score >= 0.65) {
      return {
        rating: 'Good Fit',
        emoji: '👍',
        message: 'Solid choice that works well for the situation.',
      };
    }
    if (score >= 0.50) {
      return {
        rating: 'Acceptable',
        emoji: '🤔',
        message: 'This outfit works but consider the suggestions for improvement.',
      };
    }
    if (score >= 0.35) {
      return {
        rating: 'Needs Adjustment',
        emoji: '⚠️',
        message: 'Some items may not be ideal for the weather, occasion, or your preferences.',
      };
    }
    return {
      rating: 'Not Recommended',
      emoji: '❌',
      message: 'This outfit may not be appropriate for the context. Review the suggestions.',
    };
  }
}
