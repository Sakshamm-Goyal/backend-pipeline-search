import { Injectable, Logger } from '@nestjs/common';
import { UserEventRepository, AggregatedBehavior } from '../analytics/infrastructure/persistence/user-event.repository';
import { Product } from '../search/dto/product.dto';

/**
 * Personalization Service
 *
 * Provides personalized ranking and recommendations based on user behavior.
 * Uses data from:
 * - User profile (onboarding preferences)
 * - Behavioral data (searches, clicks, saves)
 * - Wardrobe items (what they own)
 *
 * Key features:
 * - Personalized product scoring
 * - Category affinity calculation
 * - Brand preference weighting
 * - Price range optimization
 * - Style matching
 */

export interface UserProfile {
  userId: string;
  gender?: string;
  stylePreferences?: string[];
  bodyType?: string;
  priceRange?: {
    min: number;
    max: number;
    currency: string;
  };
  favoriteColors?: string[];
  favoriteCategories?: string[];
  favoriteBrands?: string[];
  occasions?: string[];
  sizes?: Record<string, string>; // category -> size
}

export interface PersonalizationContext {
  profile?: UserProfile;
  behavior?: AggregatedBehavior;
  currentIntent?: string;
  occasion?: string;
  budget?: { min?: number; max?: number };
}

export interface PersonalizedScore {
  baseScore: number;
  personalizationBoost: number;
  finalScore: number;
  reasons: string[];
}

@Injectable()
export class PersonalizationService {
  private readonly logger = new Logger(PersonalizationService.name);

  // Weight factors for different signals
  private readonly WEIGHTS = {
    categoryMatch: 0.15,
    brandMatch: 0.12,
    priceMatch: 0.10,
    styleMatch: 0.12,
    occasionMatch: 0.10,
    colorMatch: 0.08,
    behaviorBoost: 0.15,
    recencyBoost: 0.08,
    popularityBoost: 0.10,
  };

  constructor(private userEventRepository: UserEventRepository) {}

  /**
   * Calculate personalized score for a product
   */
  calculatePersonalizedScore(
    product: Product,
    context: PersonalizationContext,
  ): PersonalizedScore {
    const reasons: string[] = [];
    let personalizationBoost = 0;
    const baseScore = product.score || 50;

    // Category matching
    if (context.profile?.favoriteCategories?.length || context.behavior?.preferredCategories?.length) {
      const preferredCategories = [
        ...(context.profile?.favoriteCategories || []),
        ...(context.behavior?.preferredCategories || []),
      ];

      if (product.category && preferredCategories.includes(product.category.toLowerCase())) {
        personalizationBoost += this.WEIGHTS.categoryMatch * 100;
        reasons.push(`Matches preferred category: ${product.category}`);
      }
    }

    // Brand matching
    if (context.profile?.favoriteBrands?.length || context.behavior?.preferredBrands?.length) {
      const preferredBrands = [
        ...(context.profile?.favoriteBrands || []),
        ...(context.behavior?.preferredBrands || []),
      ];

      if (product.brand && preferredBrands.some((b) =>
        b.toLowerCase() === product.brand?.toLowerCase()
      )) {
        personalizationBoost += this.WEIGHTS.brandMatch * 100;
        reasons.push(`Preferred brand: ${product.brand}`);
      }
    }

    // Price range matching
    const priceRange = context.budget ||
      context.profile?.priceRange ||
      context.behavior?.preferredPriceRange;

    if (priceRange && product.price) {
      const { min = 0, max = Infinity } = priceRange;
      if (product.price >= min && product.price <= max) {
        personalizationBoost += this.WEIGHTS.priceMatch * 100;
        reasons.push('Within budget');
      } else if (product.price < min) {
        // Slight boost for below budget
        personalizationBoost += this.WEIGHTS.priceMatch * 50;
        reasons.push('Below budget');
      }
    }

    // Style matching
    if (context.profile?.stylePreferences?.length || context.behavior?.preferredStyles?.length) {
      const preferredStyles = [
        ...(context.profile?.stylePreferences || []),
        ...(context.behavior?.preferredStyles || []),
      ];

      const productTags = product.tags || [];
      const matchedStyles = productTags.filter((tag) =>
        preferredStyles.some((style) =>
          tag.toLowerCase().includes(style.toLowerCase()) ||
          style.toLowerCase().includes(tag.toLowerCase())
        )
      );

      if (matchedStyles.length > 0) {
        personalizationBoost += this.WEIGHTS.styleMatch * 100 * Math.min(matchedStyles.length / 2, 1);
        reasons.push(`Style match: ${matchedStyles.join(', ')}`);
      }
    }

    // Occasion matching
    if (context.occasion || context.profile?.occasions?.length) {
      const targetOccasions = context.occasion
        ? [context.occasion]
        : (context.profile?.occasions || []);

      const productTags = product.tags || [];
      const occasionMatch = productTags.some((tag) =>
        targetOccasions.some((occ) =>
          tag.toLowerCase().includes(occ.toLowerCase())
        )
      );

      if (occasionMatch) {
        personalizationBoost += this.WEIGHTS.occasionMatch * 100;
        reasons.push(`Matches occasion`);
      }
    }

    // Color matching
    if (context.profile?.favoriteColors?.length) {
      if (product.color && context.profile.favoriteColors.some((c) =>
        c.toLowerCase() === product.color?.toLowerCase() ||
        product.color?.toLowerCase().includes(c.toLowerCase())
      )) {
        personalizationBoost += this.WEIGHTS.colorMatch * 100;
        reasons.push(`Preferred color: ${product.color}`);
      }
    }

    // Behavior boost (engagement score)
    if (context.behavior?.engagementScore) {
      const engagementFactor = Math.min(context.behavior.engagementScore / 100, 1);
      personalizationBoost += this.WEIGHTS.behaviorBoost * 100 * engagementFactor;
    }

    // On sale boost (everyone likes a deal)
    if (product.onSale && product.discount && product.discount >= 20) {
      personalizationBoost += 5;
      reasons.push(`${product.discount}% off`);
    }

    // High rating boost
    if (product.rating && product.rating >= 4.5 && product.reviewCount && product.reviewCount > 50) {
      personalizationBoost += 3;
      reasons.push('Highly rated');
    }

    const finalScore = Math.min(100, baseScore + personalizationBoost);

    return {
      baseScore,
      personalizationBoost: Math.round(personalizationBoost * 10) / 10,
      finalScore: Math.round(finalScore * 10) / 10,
      reasons,
    };
  }

  /**
   * Rerank products based on personalization
   */
  async rerankProducts(
    products: Product[],
    userId: string,
    userProfile?: UserProfile,
    intent?: string,
    occasion?: string,
    budget?: { min?: number; max?: number },
  ): Promise<Product[]> {
    if (products.length === 0) return products;

    try {
      // Get user behavior
      const behavior = await this.userEventRepository.getAggregatedBehavior(userId);

      const context: PersonalizationContext = {
        profile: userProfile,
        behavior,
        currentIntent: intent,
        occasion,
        budget,
      };

      // Score each product
      const scoredProducts = products.map((product) => {
        const scoring = this.calculatePersonalizedScore(product, context);
        return {
          ...product,
          score: scoring.finalScore,
          rankReason: scoring.reasons.join('; ') || 'Relevance match',
        };
      });

      // Sort by personalized score
      scoredProducts.sort((a, b) => (b.score || 0) - (a.score || 0));

      this.logger.debug(
        `Reranked ${products.length} products for user ${userId}`,
      );

      return scoredProducts;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error reranking products: ${err.message}`, err.stack);
      // Return original order on error
      return products;
    }
  }

  /**
   * Get personalization context for a user
   */
  async getPersonalizationContext(
    userId: string,
    userProfile?: UserProfile,
  ): Promise<PersonalizationContext> {
    try {
      const behavior = await this.userEventRepository.getAggregatedBehavior(userId);

      return {
        profile: userProfile,
        behavior,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting context: ${err.message}`, err.stack);
      return { profile: userProfile };
    }
  }

  /**
   * Calculate category affinity scores
   */
  async getCategoryAffinities(
    userId: string,
  ): Promise<Array<{ category: string; score: number }>> {
    try {
      const behavior = await this.userEventRepository.getAggregatedBehavior(userId);

      // Map categories to scores (0-100)
      const categories = behavior.preferredCategories.slice(0, 10);
      const maxScore = 100;
      const decay = 0.8;

      return categories.map((category, index) => ({
        category,
        score: Math.round(maxScore * Math.pow(decay, index)),
      }));
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting category affinities: ${err.message}`);
      return [];
    }
  }

  /**
   * Calculate brand affinity scores
   */
  async getBrandAffinities(
    userId: string,
  ): Promise<Array<{ brand: string; score: number }>> {
    try {
      const behavior = await this.userEventRepository.getAggregatedBehavior(userId);

      const brands = behavior.preferredBrands.slice(0, 10);
      const maxScore = 100;
      const decay = 0.85;

      return brands.map((brand, index) => ({
        brand,
        score: Math.round(maxScore * Math.pow(decay, index)),
      }));
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting brand affinities: ${err.message}`);
      return [];
    }
  }

  /**
   * Get recommended search terms based on user behavior
   */
  async getRecommendedSearchTerms(
    userId: string,
    limit: number = 5,
  ): Promise<string[]> {
    try {
      const behavior = await this.userEventRepository.getAggregatedBehavior(userId);

      // Combine categories, brands, and search patterns
      const terms: string[] = [];

      // Add category suggestions
      for (const category of behavior.preferredCategories.slice(0, 2)) {
        terms.push(`${category} for ${behavior.preferredStyles[0] || 'casual'}`);
      }

      // Add brand suggestions
      for (const brand of behavior.preferredBrands.slice(0, 2)) {
        terms.push(`${brand} ${behavior.preferredCategories[0] || ''}`);
      }

      // Add search pattern variations
      for (const pattern of behavior.searchPatterns.slice(0, 3)) {
        if (pattern && !terms.includes(pattern)) {
          terms.push(pattern);
        }
      }

      return terms.slice(0, limit);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting recommended terms: ${err.message}`);
      return [];
    }
  }

  /**
   * Check if a product matches user preferences
   */
  isProductMatch(
    product: Product,
    context: PersonalizationContext,
  ): { matches: boolean; matchScore: number; reasons: string[] } {
    const scoring = this.calculatePersonalizedScore(product, context);

    return {
      matches: scoring.finalScore >= 60,
      matchScore: scoring.finalScore,
      reasons: scoring.reasons,
    };
  }
}
