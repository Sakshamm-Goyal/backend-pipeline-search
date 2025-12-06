import { Injectable, Logger } from '@nestjs/common';
import { OutfitCompatibilityService, WardrobeItemInfo, CompatibilityScore } from '../outfit-compatibility.service';
import {
  ContextPack,
  StyleConstraints,
  WeatherContext,
  EventContext,
  FashionTrend,
} from '../../context/dto/context-pack.dto';

/**
 * Context-Aware Scoring Service
 *
 * Enhances outfit scoring with full context awareness:
 * - Weather appropriateness
 * - Event/occasion suitability
 * - Trend alignment
 * - Constraint compliance
 * - User preference matching
 *
 * Extends the base OutfitCompatibilityService with contextual factors.
 */

export interface ContextAwareScore extends CompatibilityScore {
  contextFactors: {
    weatherScore: number;
    eventScore: number;
    trendScore: number;
    constraintScore: number;
    preferenceScore: number;
  };
  contextIssues: string[];
  contextSuggestions: string[];
  overallContextScore: number;
  finalScore: number; // Combined base + context score
}

export interface ScoringContext {
  weather?: WeatherContext;
  event?: EventContext;
  constraints: StyleConstraints;
  trends: FashionTrend[];
  userPreferences: {
    colorPreferences: string[];
    avoidColors: string[];
    primaryStyle: string;
    selectedStyles: string[];
    modestDressing?: boolean;
  };
}

// Material to weather mapping
const MATERIAL_WEATHER_MAP: Record<string, { good: string[]; bad: string[] }> = {
  cold: {
    good: ['wool', 'cashmere', 'fleece', 'down', 'leather', 'flannel', 'corduroy'],
    bad: ['linen', 'silk', 'mesh', 'cotton', 'rayon'],
  },
  cool: {
    good: ['cotton', 'wool', 'denim', 'flannel', 'jersey', 'knit'],
    bad: ['mesh', 'sheer', 'linen'],
  },
  mild: {
    good: ['cotton', 'jersey', 'denim', 'linen', 'wool blend'],
    bad: ['down', 'fleece', 'heavy wool'],
  },
  warm: {
    good: ['cotton', 'linen', 'chambray', 'rayon', 'jersey'],
    bad: ['wool', 'fleece', 'leather', 'velvet', 'corduroy'],
  },
  hot: {
    good: ['linen', 'cotton', 'chambray', 'moisture-wicking', 'rayon'],
    bad: ['wool', 'fleece', 'leather', 'polyester', 'velvet', 'down'],
  },
};

// Formality to style mapping
const FORMALITY_STYLE_MAP: Record<string, string[]> = {
  casual: ['casual', 'streetwear', 'athletic', 'bohemian', 'relaxed'],
  smart_casual: ['smart casual', 'classic', 'preppy', 'minimalist', 'contemporary'],
  business_casual: ['business casual', 'classic', 'professional', 'polished'],
  business: ['business', 'professional', 'classic', 'formal', 'tailored'],
  formal: ['formal', 'elegant', 'classic', 'sophisticated', 'dressy'],
  black_tie: ['black tie', 'formal', 'elegant', 'evening', 'glamorous'],
};

// Category to formality appropriateness
const CATEGORY_FORMALITY: Record<string, string[]> = {
  // Highly casual items
  shorts: ['casual'],
  tank_top: ['casual'],
  flip_flops: ['casual'],
  hoodie: ['casual', 'smart_casual'],
  sneakers: ['casual', 'smart_casual'],
  // Versatile items
  jeans: ['casual', 'smart_casual'],
  tshirt: ['casual', 'smart_casual'],
  // More formal items
  blazer: ['smart_casual', 'business_casual', 'business', 'formal'],
  dress_shoes: ['business_casual', 'business', 'formal', 'black_tie'],
  suit: ['business', 'formal', 'black_tie'],
  dress: ['smart_casual', 'business_casual', 'business', 'formal', 'black_tie'],
};

@Injectable()
export class ContextAwareScoringService {
  private readonly logger = new Logger(ContextAwareScoringService.name);

  // Context scoring weights
  private readonly CONTEXT_WEIGHTS = {
    weather: 0.25,
    event: 0.25,
    trends: 0.15,
    constraints: 0.20,
    preferences: 0.15,
  };

  // Balance between base and context scores
  private readonly BASE_WEIGHT = 0.6;
  private readonly CONTEXT_WEIGHT = 0.4;

  constructor(private compatibilityService: OutfitCompatibilityService) {}

  /**
   * Score outfit with full context awareness
   */
  async scoreWithContext(
    items: WardrobeItemInfo[],
    context: ScoringContext,
  ): Promise<ContextAwareScore> {
    // Get base compatibility score
    const baseScore = await this.compatibilityService.scoreOutfit(items);

    // Calculate context-specific scores
    const contextIssues: string[] = [];
    const contextSuggestions: string[] = [];

    const weatherScore = this.calculateWeatherScore(items, context, contextIssues, contextSuggestions);
    const eventScore = this.calculateEventScore(items, context, contextIssues, contextSuggestions);
    const trendScore = this.calculateTrendScore(items, context, contextIssues, contextSuggestions);
    const constraintScore = this.calculateConstraintScore(items, context, contextIssues, contextSuggestions);
    const preferenceScore = this.calculatePreferenceScore(items, context, contextIssues, contextSuggestions);

    // Calculate overall context score
    const overallContextScore =
      weatherScore * this.CONTEXT_WEIGHTS.weather +
      eventScore * this.CONTEXT_WEIGHTS.event +
      trendScore * this.CONTEXT_WEIGHTS.trends +
      constraintScore * this.CONTEXT_WEIGHTS.constraints +
      preferenceScore * this.CONTEXT_WEIGHTS.preferences;

    // Calculate final combined score
    const finalScore =
      baseScore.overall * this.BASE_WEIGHT +
      overallContextScore * this.CONTEXT_WEIGHT;

    return {
      ...baseScore,
      issues: [...baseScore.issues, ...contextIssues],
      suggestions: [...baseScore.suggestions, ...contextSuggestions],
      contextFactors: {
        weatherScore: Math.round(weatherScore * 100) / 100,
        eventScore: Math.round(eventScore * 100) / 100,
        trendScore: Math.round(trendScore * 100) / 100,
        constraintScore: Math.round(constraintScore * 100) / 100,
        preferenceScore: Math.round(preferenceScore * 100) / 100,
      },
      contextIssues,
      contextSuggestions,
      overallContextScore: Math.round(overallContextScore * 100) / 100,
      finalScore: Math.round(finalScore * 100) / 100,
    };
  }

  /**
   * Score outfit with ContextPack (convenience method)
   */
  async scoreWithContextPack(
    items: WardrobeItemInfo[],
    contextPack: ContextPack,
  ): Promise<ContextAwareScore> {
    const context: ScoringContext = {
      weather: contextPack.weather,
      event: contextPack.eventContext,
      constraints: contextPack.constraints,
      trends: contextPack.trends,
      userPreferences: {
        colorPreferences: contextPack.userProfile.stylePreferences.colorPreferences,
        avoidColors: contextPack.userProfile.stylePreferences.avoidColors,
        primaryStyle: contextPack.userProfile.stylePreferences.primaryStyle,
        selectedStyles: contextPack.userProfile.stylePreferences.selectedStyles,
        modestDressing: contextPack.userProfile.stylePreferences.modestDressing,
      },
    };

    return this.scoreWithContext(items, context);
  }

  /**
   * Calculate weather appropriateness score
   */
  private calculateWeatherScore(
    items: WardrobeItemInfo[],
    context: ScoringContext,
    issues: string[],
    suggestions: string[],
  ): number {
    if (!context.weather) {
      return 0.7; // Default score when no weather data
    }

    let score = 0.5; // Base score
    const tempRange = context.constraints.temperatureRange;
    const materialMap = MATERIAL_WEATHER_MAP[tempRange];

    if (!materialMap) {
      return 0.7;
    }

    let goodMaterialCount = 0;
    let badMaterialCount = 0;

    for (const item of items) {
      const material = (item.material || '').toLowerCase();

      // Check for good materials
      for (const goodMaterial of materialMap.good) {
        if (material.includes(goodMaterial)) {
          goodMaterialCount++;
          break;
        }
      }

      // Check for bad materials
      for (const badMaterial of materialMap.bad) {
        if (material.includes(badMaterial)) {
          badMaterialCount++;
          break;
        }
      }
    }

    // Calculate material-based score
    if (items.length > 0) {
      score += (goodMaterialCount / items.length) * 0.3;
      score -= (badMaterialCount / items.length) * 0.3;
    }

    // Check for required items
    if (context.constraints.needsOuterwear) {
      const hasOuterwear = items.some(i =>
        ['jacket', 'coat', 'blazer', 'cardigan', 'vest', 'parka'].some(cat =>
          i.category?.toString().toLowerCase().includes(cat)
        )
      );
      if (!hasOuterwear) {
        score -= 0.2;
        issues.push('Missing outerwear for cold weather');
        suggestions.push('Consider adding a jacket or coat');
      } else {
        score += 0.1;
      }
    }

    // Check for rain protection
    if (context.constraints.needsRainProtection) {
      // Would check for waterproof items, umbrellas, etc.
      suggestions.push('Consider bringing rain protection');
    }

    // Temperature-specific penalties
    const temp = context.weather.temperature;
    if (temp > 85) {
      // Hot weather - check for heavy items
      const hasHeavyItems = items.some(i =>
        ['wool', 'fleece', 'leather', 'down'].some(m =>
          (i.material || '').toLowerCase().includes(m)
        )
      );
      if (hasHeavyItems) {
        score -= 0.2;
        issues.push('Some items may be too warm for hot weather');
      }
    } else if (temp < 40) {
      // Cold weather - check for light items
      const hasLightItems = items.some(i =>
        ['linen', 'mesh', 'silk'].some(m =>
          (i.material || '').toLowerCase().includes(m)
        )
      );
      if (hasLightItems) {
        score -= 0.2;
        issues.push('Some items may be too light for cold weather');
      }
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate event/occasion appropriateness score
   */
  private calculateEventScore(
    items: WardrobeItemInfo[],
    context: ScoringContext,
    issues: string[],
    suggestions: string[],
  ): number {
    if (!context.event) {
      return 0.7; // Default when no event context
    }

    let score = 0.5; // Base score
    const formality = context.event.formality;
    const appropriateStyles = FORMALITY_STYLE_MAP[formality] || [];

    // Check style alignment
    let styleMatches = 0;
    let styleMismatches = 0;

    for (const item of items) {
      const itemStyles = item.style || [];

      for (const style of itemStyles) {
        if (appropriateStyles.some(s => style.toLowerCase().includes(s))) {
          styleMatches++;
        } else {
          // Check if it's a conflicting formality
          const isConflicting = this.isStyleConflicting(style, formality);
          if (isConflicting) {
            styleMismatches++;
          }
        }
      }
    }

    if (items.length > 0) {
      score += (styleMatches / items.length) * 0.3;
      score -= (styleMismatches / items.length) * 0.3;
    }

    // Check category appropriateness
    for (const item of items) {
      const category = item.category?.toString().toLowerCase() || '';
      const categoryFormalities = CATEGORY_FORMALITY[category];

      if (categoryFormalities && !categoryFormalities.includes(formality)) {
        score -= 0.1;
        issues.push(`${category} may not be appropriate for ${formality} occasions`);
      }
    }

    // Setting type considerations
    if (context.event.settingType === 'outdoor') {
      // Outdoor events may need more practical choices
      const hasComfortableShoes = items.some(i =>
        ['sneakers', 'flats', 'boots'].some(cat =>
          i.category?.toString().toLowerCase().includes(cat)
        )
      );
      if (!hasComfortableShoes) {
        suggestions.push('Consider comfortable footwear for outdoor setting');
      }
    }

    // Activity level considerations
    if (context.event.activityLevel === 'high') {
      suggestions.push('Ensure outfit allows for movement and comfort');
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Check if a style conflicts with formality
   */
  private isStyleConflicting(style: string, formality: string): boolean {
    const styleLower = style.toLowerCase();

    // Casual styles vs formal events
    if (['formal', 'black_tie', 'business'].includes(formality)) {
      if (['streetwear', 'athletic', 'bohemian', 'grunge'].some(s => styleLower.includes(s))) {
        return true;
      }
    }

    // Formal styles vs casual events
    if (formality === 'casual') {
      if (['formal', 'black tie', 'evening'].some(s => styleLower.includes(s))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculate trend alignment score
   */
  private calculateTrendScore(
    items: WardrobeItemInfo[],
    context: ScoringContext,
    issues: string[],
    suggestions: string[],
  ): number {
    if (!context.trends || context.trends.length === 0) {
      return 0.7; // Default when no trend data
    }

    let score = 0.5; // Base score
    let trendMatches = 0;

    // Check each item against trends
    for (const item of items) {
      const itemText = [
        item.dominantColor,
        item.material,
        ...(item.style || []),
        item.category?.toString(),
      ].filter(Boolean).join(' ').toLowerCase();

      for (const trend of context.trends) {
        const trendName = trend.name.toLowerCase();

        if (itemText.includes(trendName)) {
          trendMatches++;
          score += trend.relevanceScore * 0.1;
          break; // Count each item once
        }
      }
    }

    // Bonus for having multiple trending items
    if (trendMatches >= 2) {
      score += 0.1;
    }

    // Cap and provide suggestions
    if (trendMatches === 0 && context.trends.length > 0) {
      const topTrend = context.trends[0];
      suggestions.push(`Consider incorporating ${topTrend.name} for a trendy look`);
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate constraint compliance score
   */
  private calculateConstraintScore(
    items: WardrobeItemInfo[],
    context: ScoringContext,
    issues: string[],
    suggestions: string[],
  ): number {
    let score = 1.0; // Start at full score, deduct for violations
    const constraints = context.constraints;

    // Check preferred materials
    if (constraints.preferredMaterials.length > 0) {
      const hasPreferred = items.some(i =>
        constraints.preferredMaterials.some(m =>
          (i.material || '').toLowerCase().includes(m.toLowerCase())
        )
      );
      if (!hasPreferred) {
        score -= 0.1;
        suggestions.push(`Consider items made from ${constraints.preferredMaterials.slice(0, 2).join(' or ')}`);
      }
    }

    // Check avoided materials
    for (const item of items) {
      const material = (item.material || '').toLowerCase();
      for (const avoidMaterial of constraints.avoidMaterials) {
        if (material.includes(avoidMaterial.toLowerCase())) {
          score -= 0.15;
          issues.push(`${item.category} contains ${avoidMaterial} which should be avoided`);
        }
      }
    }

    // Check coverage requirements
    if (constraints.minCoverage === 'full') {
      // Check for revealing items
      const hasRevealingItems = items.some(i => {
        const category = i.category?.toString().toLowerCase() || '';
        return ['crop_top', 'shorts', 'mini_skirt', 'tank_top'].some(c => category.includes(c));
      });
      if (hasRevealingItems) {
        score -= 0.2;
        issues.push('Some items may not provide full coverage');
        suggestions.push('Consider more covered alternatives for modest dressing');
      }
    }

    // Check layering requirement
    if (constraints.suggestLayering) {
      const layerableItems = items.filter(i => {
        const category = i.category?.toString().toLowerCase() || '';
        return ['cardigan', 'jacket', 'blazer', 'sweater', 'vest'].some(c => category.includes(c));
      });
      if (layerableItems.length < constraints.layerCount - 1) {
        score -= 0.1;
        suggestions.push('Consider adding layering pieces for the weather');
      }
    }

    return Math.max(0, score);
  }

  /**
   * Calculate user preference match score
   */
  private calculatePreferenceScore(
    items: WardrobeItemInfo[],
    context: ScoringContext,
    issues: string[],
    suggestions: string[],
  ): number {
    let score = 0.5; // Base score
    const prefs = context.userPreferences;

    // Check color preferences
    if (prefs.colorPreferences.length > 0) {
      const matchingColors = items.filter(i =>
        prefs.colorPreferences.some(c =>
          (i.dominantColor || '').toLowerCase().includes(c.toLowerCase())
        )
      ).length;

      score += (matchingColors / Math.max(1, items.length)) * 0.2;
    }

    // Check avoided colors
    if (prefs.avoidColors.length > 0) {
      const avoidedColors = items.filter(i =>
        prefs.avoidColors.some(c =>
          (i.dominantColor || '').toLowerCase().includes(c.toLowerCase())
        )
      ).length;

      if (avoidedColors > 0) {
        score -= avoidedColors * 0.1;
        issues.push('Some items contain colors you prefer to avoid');
      }
    }

    // Check style preference match
    const userStyles = [...prefs.selectedStyles, prefs.primaryStyle].map(s => s.toLowerCase());
    let styleMatches = 0;

    for (const item of items) {
      const itemStyles = (item.style || []).map(s => s.toLowerCase());
      if (itemStyles.some(s => userStyles.some(us => s.includes(us) || us.includes(s)))) {
        styleMatches++;
      }
    }

    if (items.length > 0) {
      score += (styleMatches / items.length) * 0.2;
    }

    // Modest dressing check
    if (prefs.modestDressing) {
      const modestScore = this.calculateModestDressingScore(items);
      score = (score + modestScore) / 2;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate modest dressing compliance
   */
  private calculateModestDressingScore(items: WardrobeItemInfo[]): number {
    let score = 1.0;

    for (const item of items) {
      const category = item.category?.toString().toLowerCase() || '';

      // Deduct for revealing items
      if (['crop_top', 'mini_skirt', 'short_shorts', 'bikini', 'tank_top'].some(c => category.includes(c))) {
        score -= 0.2;
      }

      // Bonus for covered items
      if (['maxi_dress', 'long_sleeve', 'midi_skirt', 'pants', 'cardigan'].some(c => category.includes(c))) {
        score += 0.05;
      }
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Get scoring explanation
   */
  getScoreExplanation(score: ContextAwareScore): string {
    const parts: string[] = [];

    parts.push(`Overall Score: ${(score.finalScore * 100).toFixed(0)}%`);
    parts.push('');
    parts.push('Base Compatibility:');
    parts.push(`  - Color Harmony: ${(score.components.colorHarmony * 100).toFixed(0)}%`);
    parts.push(`  - Pattern Balance: ${(score.components.patternBalance * 100).toFixed(0)}%`);
    parts.push(`  - Style Cohesion: ${(score.components.styleCohesion * 100).toFixed(0)}%`);
    parts.push('');
    parts.push('Context Factors:');
    parts.push(`  - Weather Fit: ${(score.contextFactors.weatherScore * 100).toFixed(0)}%`);
    parts.push(`  - Event Fit: ${(score.contextFactors.eventScore * 100).toFixed(0)}%`);
    parts.push(`  - Trend Alignment: ${(score.contextFactors.trendScore * 100).toFixed(0)}%`);
    parts.push(`  - Constraint Compliance: ${(score.contextFactors.constraintScore * 100).toFixed(0)}%`);
    parts.push(`  - Preference Match: ${(score.contextFactors.preferenceScore * 100).toFixed(0)}%`);

    if (score.issues.length > 0) {
      parts.push('');
      parts.push('Issues:');
      score.issues.forEach(issue => parts.push(`  - ${issue}`));
    }

    if (score.suggestions.length > 0) {
      parts.push('');
      parts.push('Suggestions:');
      score.suggestions.forEach(sug => parts.push(`  - ${sug}`));
    }

    return parts.join('\n');
  }

  /**
   * Compare multiple outfits with context
   */
  async compareOutfits(
    outfits: WardrobeItemInfo[][],
    context: ScoringContext,
  ): Promise<Array<{ index: number; score: ContextAwareScore; rank: number }>> {
    const scores = await Promise.all(
      outfits.map(async (items, index) => ({
        index,
        score: await this.scoreWithContext(items, context),
        rank: 0,
      }))
    );

    // Sort by final score and assign ranks
    scores.sort((a, b) => b.score.finalScore - a.score.finalScore);
    scores.forEach((s, i) => {
      s.rank = i + 1;
    });

    // Return in original order
    return scores.sort((a, b) => a.index - b.index);
  }
}
