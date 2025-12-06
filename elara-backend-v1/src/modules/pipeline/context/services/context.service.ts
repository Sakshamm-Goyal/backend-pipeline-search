import { Injectable, Logger } from '@nestjs/common';
import { WeatherService } from './weather.service';
import { EventIntelligenceService } from './event-intelligence.service';
import { ConstraintDerivationService } from './constraint-derivation.service';
import { OnboardingService } from '../../../onboarding/application/services/onboarding.service';
import { WardrobeService } from '../../../wardrobe/application/services/wardrobe.service';
import {
  ContextPack,
  ContextFilters,
  UserProfileContext,
  WardrobeItem,
  FASHION_TRENDS_2025,
} from '../dto/context-pack.dto';

/**
 * Context Service
 *
 * Orchestrates the collection and preparation of all contextual information
 * needed for outfit generation and product recommendations.
 *
 * This is the main entry point for the deterministic context layer.
 */
@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);

  constructor(
    private weatherService: WeatherService,
    private eventIntelligenceService: EventIntelligenceService,
    private constraintDerivationService: ConstraintDerivationService,
    private onboardingService: OnboardingService,
    private wardrobeService: WardrobeService,
  ) {}

  /**
   * Prepare comprehensive context pack for a user
   */
  async prepare(userId: string, filters: ContextFilters): Promise<ContextPack> {
    const startTime = Date.now();

    this.logger.log(`Preparing context for user ${userId}`);

    // Parallel execution of independent data fetching
    const [userProfile, wardrobeItems, weather] = await Promise.all([
      this.getUserProfile(userId),
      this.getWardrobeItems(userId),
      this.weatherService.getWeather(filters.location),
    ]);

    // Analyze event context (depends on filters only)
    const eventContext = await this.eventIntelligenceService.analyze({
      occasion: filters.occasion,
      location: filters.location,
      datetime: filters.datetime,
    });

    // Derive constraints from weather and event
    const constraints = this.constraintDerivationService.derive(weather, eventContext);

    // Apply user-specific constraint overrides
    this.applyUserPreferenceOverrides(constraints, userProfile);

    // Get relevant fashion trends
    const trends = this.getRelevantTrends(userProfile, eventContext);

    const contextPack: ContextPack = {
      userProfile,
      wardrobe: wardrobeItems,
      weather,
      constraints,
      eventContext,
      trends,
      filters,
      timestamp: new Date(),
    };

    const duration = Date.now() - startTime;
    this.logger.log(`Context prepared in ${duration}ms`);

    return contextPack;
  }

  /**
   * Get user profile from onboarding service
   */
  private async getUserProfile(userId: string): Promise<UserProfileContext> {
    try {
      const profile = await this.onboardingService.getProfile(userId);

      if (!profile) {
        return this.getDefaultProfile(userId);
      }

      // Map Gender enum to string literal
      const genderMap: Record<string, 'male' | 'female' | 'unisex'> = {
        male: 'male',
        female: 'female',
        non_binary: 'unisex',
        prefer_not_to_say: 'unisex',
      };

      return {
        userId,
        gender: genderMap[profile.gender?.toString().toLowerCase() || ''] || 'unisex',
        stylePreferences: {
          primaryStyle: profile.stylePreferences?.primaryStyle?.toString() || 'classic',
          selectedStyles: (profile.stylePreferences?.selectedStyles || []).map(s => s.toString()),
          colorPreferences: profile.stylePreferences?.colorPreferences || [],
          avoidColors: profile.stylePreferences?.avoidColors || [],
          modestDressing: profile.stylePreferences?.modestDressing,
        },
        brandPreferences: {
          likedBrands: profile.brandPreferences?.likedBrands || [],
          dislikedBrands: profile.brandPreferences?.dislikedBrands || [],
          priceRange: {
            min: profile.brandPreferences?.priceRange?.min || 0,
            max: profile.brandPreferences?.priceRange?.max || 500,
          },
        },
        bodyProfile: profile.fullBodyAnalysis?.final ? {
          bodyType: profile.fullBodyAnalysis.final.bodyType?.toString(),
          height: profile.fullBodyAnalysis.final.heightCm,
        } : undefined,
        location: profile.location,
      };
    } catch (error) {
      this.logger.warn(`Could not load profile for ${userId}, using defaults`);
      return this.getDefaultProfile(userId);
    }
  }

  /**
   * Get wardrobe items for a user
   */
  private async getWardrobeItems(userId: string): Promise<WardrobeItem[]> {
    try {
      // Get all items without filters
      const result = await this.wardrobeService.getUserItems(userId, {});

      // Handle both array and paginated response formats
      const items = Array.isArray(result) ? result : (result.items || []);

      return items.map((item: any) => ({
        id: item._id?.toString() || item.id,
        name: item.name || item.title || 'Unnamed Item',
        category: item.category || 'other',
        subcategory: item.subcategory,
        color: item.color || item.dominantColor || 'unknown',
        brand: item.brand,
        imageUrl: item.imageUrl,
        tags: item.tags || [],
        wearCount: item.wearCount,
        lastWorn: item.lastWorn,
        seasonality: item.seasonality,
      }));
    } catch (error) {
      this.logger.warn(`Could not load wardrobe for ${userId}`);
      return [];
    }
  }

  /**
   * Get default profile for users without onboarding
   */
  private getDefaultProfile(userId: string): UserProfileContext {
    return {
      userId,
      gender: 'unisex',
      stylePreferences: {
        primaryStyle: 'classic',
        selectedStyles: ['casual', 'smart casual'],
        colorPreferences: [],
        avoidColors: [],
      },
      brandPreferences: {
        likedBrands: [],
        dislikedBrands: [],
        priceRange: {
          min: 20,
          max: 200,
        },
      },
    };
  }

  /**
   * Apply user preference overrides to constraints
   */
  private applyUserPreferenceOverrides(
    constraints: any,
    userProfile: UserProfileContext,
  ): void {
    // Apply modest dressing preference
    if (userProfile.stylePreferences.modestDressing) {
      constraints.minCoverage = 'full';
    }

    // Add user's avoid colors to seasonal colors filter
    if (userProfile.stylePreferences.avoidColors?.length > 0) {
      constraints.avoidColors = userProfile.stylePreferences.avoidColors;
    }
  }

  /**
   * Get relevant fashion trends based on user and event
   */
  private getRelevantTrends(
    userProfile: UserProfileContext,
    eventContext?: any,
  ): any[] {
    let trends = [...FASHION_TRENDS_2025];

    // Filter by user's style preferences
    const userStyles = userProfile.stylePreferences.selectedStyles.map(s => s.toLowerCase());

    // Boost relevance for matching styles
    trends = trends.map(trend => {
      let boostedScore = trend.relevanceScore;

      // Boost for style match
      if (trend.category === 'style' && userStyles.some(s => trend.name.toLowerCase().includes(s))) {
        boostedScore += 0.1;
      }

      // Boost for color preferences
      if (
        trend.category === 'color' &&
        userProfile.stylePreferences.colorPreferences.some(c =>
          trend.name.toLowerCase().includes(c.toLowerCase())
        )
      ) {
        boostedScore += 0.1;
      }

      // Penalize for avoided colors
      if (
        trend.category === 'color' &&
        userProfile.stylePreferences.avoidColors.some(c =>
          trend.name.toLowerCase().includes(c.toLowerCase())
        )
      ) {
        boostedScore -= 0.3;
      }

      return {
        ...trend,
        relevanceScore: Math.min(1, Math.max(0, boostedScore)),
      };
    });

    // Sort by relevance
    trends.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Return top 10 most relevant
    return trends.slice(0, 10);
  }

  /**
   * Get a quick context summary for logging/debugging
   */
  summarize(contextPack: ContextPack): string {
    const parts: string[] = [];

    parts.push(`User: ${contextPack.userProfile.userId}`);
    parts.push(`Style: ${contextPack.userProfile.stylePreferences.primaryStyle}`);
    parts.push(`Gender: ${contextPack.userProfile.gender}`);

    if (contextPack.weather) {
      parts.push(`Weather: ${contextPack.weather.temperature}°F, ${contextPack.weather.condition}`);
    }

    if (contextPack.eventContext) {
      parts.push(`Event: ${contextPack.eventContext.occasion} (${contextPack.eventContext.formality})`);
    }

    parts.push(`Wardrobe: ${contextPack.wardrobe.length} items`);
    parts.push(`Constraints: ${contextPack.constraints.temperatureRange}, ${contextPack.constraints.minCoverage} coverage`);

    return parts.join(' | ');
  }
}
