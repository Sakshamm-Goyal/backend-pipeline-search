import { Injectable, Logger } from '@nestjs/common';

/**
 * Outfit Recommendation Scoring Service
 *
 * Ported from Python pipeline: scoring_matrix.py
 *
 * Implements the weighted scoring matrix for outfit recommendations:
 * - Weather (20%): Fabric & layering appropriateness
 * - Occasion (25%): Dress code match (HIGHEST weight)
 * - Color (20%): Skin tone + user preferences
 * - Fit/Body (20%): Body type compatibility
 * - Brand/Budget (10%): Budget compliance
 * - Trend (5%): Fashion trends alignment
 */

export interface OutfitItem {
  slot: string;
  name: string;
  source?: string;
  retailer?: string;
  price?: { value: number; currency: string } | number;
  [key: string]: any;
}

export interface OutfitData {
  name: string;
  items: OutfitItem[];
  reasoning?: any;
  score_suggestion?: number;
  [key: string]: any;
}

export interface ScoringContext {
  session: {
    occasion?: string;
    vibe?: string;
    location?: string;
    datetime_local_iso?: string;
  };
  user_profile: {
    gender?: string;
    skin_tone?: string;
    body_type?: string;
    fit_pref?: string;
    color_prefs?: string[];
    brand_prefs?: string[];
  };
  weather_compact?: {
    temp_c?: number;
    precip_mm?: number;
    wind_kph?: number;
    humidity?: number;
    conditions?: string;
  };
  derived?: {
    temp_band?: 'cold' | 'cool' | 'mild' | 'warm';
    rain?: boolean;
    outerwear_allowed?: boolean;
  };
  constraints?: {
    budget?: {
      soft_cap?: number;
      hard_cap?: number;
    };
  };
  trend_tags?: Array<{ tag: string; w: number }>;
}

export interface ScoringResult {
  finalScore: number;
  components: {
    weather: number;
    occasion: number;
    color: number;
    fitBody: number;
    brandBudget: number;
    trend: number;
  };
}

// Scoring weights (must sum to 1.0) - from Python
const WEIGHTS = {
  weather: 0.2,
  occasion: 0.25,
  color: 0.2,
  fitBody: 0.2,
  brandBudget: 0.1,
  trend: 0.05,
};

@Injectable()
export class OutfitRecommendationScoringService {
  private readonly logger = new Logger(OutfitRecommendationScoringService.name);

  /**
   * Clamp value between 0 and 10
   */
  private clamp(x: number): number {
    return Math.max(0, Math.min(10, x));
  }

  /**
   * Convert outfit to lowercase JSON string for text matching
   */
  private jsonText(obj: any): string {
    try {
      return JSON.stringify(obj).toLowerCase();
    } catch {
      return '';
    }
  }

  /**
   * Score weather appropriateness (0-10)
   * Considers temperature band, fabric choices, and rain conditions
   */
  scoreWeather(outfit: OutfitData, derived: ScoringContext['derived']): number {
    if (!derived) return 7.0;

    const band = derived.temp_band || 'mild';
    const txt = this.jsonText(outfit);
    let s = 7.0; // baseline

    // Positive adjustments
    if (
      ['warm', 'mild'].includes(band) &&
      ['linen', 'cotton', 'light'].some((kw) => txt.includes(kw))
    ) {
      s += 1.5;
    }
    if (
      ['cold', 'cool'].includes(band) &&
      ['wool', 'knit', 'layer', 'jacket'].some((kw) => txt.includes(kw))
    ) {
      s += 1.5;
    }

    // Negative adjustments
    if (
      derived.rain &&
      ['suede', 'canvas sneakers'].some((kw) => txt.includes(kw))
    ) {
      s -= 2.0;
    }
    if (
      band === 'warm' &&
      ['wool', 'heavy', 'thick'].some((kw) => txt.includes(kw))
    ) {
      s -= 1.5;
    }

    return this.clamp(s);
  }

  /**
   * Score occasion appropriateness (0-10)
   * Maps occasion types to expected garments and formality
   */
  scoreOccasion(
    outfit: OutfitData,
    occasion: string,
    vibe: string,
  ): number {
    const txt = this.jsonText(outfit);
    const occasionLower = (occasion || 'casual').toLowerCase();
    const vibeLower = (vibe || 'casual').toLowerCase();

    let s = 7.0; // baseline

    // Wedding scoring
    if (occasionLower.includes('wedding')) {
      if (
        ['blazer', 'dress shirt', 'loafers', 'oxford', 'chinos'].some((kw) =>
          txt.includes(kw),
        )
      ) {
        s += 2.0;
      }
      if (
        ['chill', 'casual'].some((v) => vibeLower.includes(v)) &&
        ['linen', 'light', 'summer'].some((kw) => txt.includes(kw))
      ) {
        s += 1.0;
      }
      if (
        ['t-shirt', 'shorts', 'flip-flops'].some((kw) => txt.includes(kw))
      ) {
        s -= 2.0;
      }
    }
    // Work/Business scoring
    else if (
      occasionLower.includes('work') ||
      occasionLower.includes('business')
    ) {
      if (
        ['blazer', 'dress shirt', 'trousers', 'oxford', 'loafers'].some((kw) =>
          txt.includes(kw),
        )
      ) {
        s += 2.0;
      }
      if (['jeans', 'sneakers', 't-shirt'].some((kw) => txt.includes(kw))) {
        s -= 1.5;
      }
    }
    // Casual/Date scoring
    else if (
      ['casual', 'date', 'dinner'].some((kw) => occasionLower.includes(kw))
    ) {
      if (
        ['jeans', 'chinos', 'polo', 'shirt', 'sneakers', 'loafers'].some((kw) =>
          txt.includes(kw),
        )
      ) {
        s += 1.5;
      }
      if (
        vibeLower.includes('formal') &&
        ['blazer', 'dress shirt'].some((kw) => txt.includes(kw))
      ) {
        s += 1.0;
      }
    }

    return this.clamp(s);
  }

  /**
   * Score color compatibility (0-10)
   * Considers skin tone and user color preferences
   */
  scoreColor(
    outfit: OutfitData,
    userProfile: ScoringContext['user_profile'],
  ): number {
    if (!userProfile) return 7.0;

    const skin = (userProfile.skin_tone || '').toLowerCase();
    const colorPrefs = userProfile.color_prefs || [];
    const prefs = colorPrefs.map((c) => (c || '').toLowerCase()).filter(Boolean);
    const txt = this.jsonText(outfit).substring(0, 300); // limit search space

    let s = 7.0; // baseline

    // Preference matches
    const prefMatches = prefs.filter((p) => txt.includes(p)).length;
    s += Math.min(2.0, prefMatches * 0.8);

    // Skin tone complementary colors
    if (['olive', 'medium'].includes(skin)) {
      if (
        ['beige', 'brown', 'olive', 'off-white', 'cream', 'earth'].some((kw) =>
          txt.includes(kw),
        )
      ) {
        s += 1.0;
      }
      if (['neon', 'bright pink'].some((kw) => txt.includes(kw))) {
        s -= 0.5;
      }
    } else if (['fair', 'light'].includes(skin)) {
      if (
        ['navy', 'charcoal', 'burgundy', 'forest green'].some((kw) =>
          txt.includes(kw),
        )
      ) {
        s += 1.0;
      }
    } else if (['deep', 'dark'].includes(skin)) {
      if (
        ['white', 'cream', 'pastels', 'bright colors'].some((kw) =>
          txt.includes(kw),
        )
      ) {
        s += 1.0;
      }
    }

    return this.clamp(s);
  }

  /**
   * Score fit and body type compatibility (0-10)
   */
  scoreFitBody(
    outfit: OutfitData,
    userProfile: ScoringContext['user_profile'],
  ): number {
    if (!userProfile) return 7.0;

    const fit = (userProfile.fit_pref || '').toLowerCase();
    const bodyType = (userProfile.body_type || '').toLowerCase();
    const txt = this.jsonText(outfit);

    let s = 7.0; // baseline

    // Fit preference matches
    if (fit && txt.includes(fit)) {
      s += 1.5;
    }

    // Body type specific adjustments
    if (bodyType.includes('athletic')) {
      if (['slim', 'tapered', 'fitted'].some((kw) => txt.includes(kw))) {
        s += 1.0;
      }
      // Penalize double oversized
      const oversizedCount = (txt.match(/oversized/g) || []).length;
      if (oversizedCount > 1) {
        s -= 1.0;
      }
    } else if (bodyType.includes('slim')) {
      if (['slim', 'fitted', 'tailored'].some((kw) => txt.includes(kw))) {
        s += 1.0;
      }
    } else if (['plus', 'curvy'].some((kw) => bodyType.includes(kw))) {
      if (['relaxed', 'comfort', 'stretch'].some((kw) => txt.includes(kw))) {
        s += 1.0;
      }
    }

    return this.clamp(s);
  }

  /**
   * Score brand and budget alignment (0-10)
   */
  scoreBrandBudget(
    items: OutfitItem[],
    brandPrefs: string[],
    budget: { soft_cap?: number; hard_cap?: number },
  ): number {
    let s = 7.0; // baseline

    // Brand preference matches
    const itemSources = items
      .map((i) => (i.source || i.retailer || '').toLowerCase())
      .join(' ');
    const brandMatches = (brandPrefs || []).filter((b) =>
      itemSources.includes((b || '').toLowerCase()),
    ).length;
    s += Math.min(2.0, brandMatches * 0.7);

    // Budget compliance
    const totalCost = items.reduce((sum, item) => {
      if (typeof item.price === 'object' && item.price?.value) {
        return sum + item.price.value;
      } else if (typeof item.price === 'number') {
        return sum + item.price;
      }
      return sum;
    }, 0);

    const hardCap = budget?.hard_cap || 300;
    const softCap = budget?.soft_cap || 150;

    if (totalCost > hardCap) {
      s -= 3.0; // major penalty for exceeding hard budget
    } else if (totalCost > softCap) {
      s -= 1.0; // minor penalty for exceeding soft budget
    } else if (totalCost <= softCap * 0.7) {
      s += 1.0; // bonus for being well under budget
    }

    return this.clamp(s);
  }

  /**
   * Score trend alignment (0-10)
   */
  scoreTrend(
    outfit: OutfitData,
    trendTags: Array<{ tag: string; w: number }>,
  ): number {
    const txt = this.jsonText(outfit);
    let s = 6.0; // baseline

    if (!trendTags || trendTags.length === 0) {
      return s;
    }

    // Accumulate trend matches with weights
    const trendBonus = trendTags.reduce((sum, t) => {
      if (t?.tag && txt.includes(t.tag.toLowerCase())) {
        return sum + (t.w || 0);
      }
      return sum;
    }, 0);

    s += Math.min(3.0, trendBonus * 1.5);

    return this.clamp(s);
  }

  /**
   * Compute the final weighted score for an outfit
   *
   * @param outfit - The outfit data
   * @param items - The outfit items
   * @param ctx - The scoring context
   * @returns Final score (0-10) and component breakdown
   */
  finalScore(
    outfit: OutfitData,
    items: OutfitItem[],
    ctx: ScoringContext,
  ): ScoringResult {
    // Safe defaults
    const session = ctx.session || {};
    const occasion = session.occasion || 'casual';
    const vibe = session.vibe || 'casual';
    const userProfile = ctx.user_profile || {};
    const derived = ctx.derived || {};
    const constraints = ctx.constraints || {};
    const budget = constraints.budget || {};
    const trendTags = ctx.trend_tags || [];

    // Calculate component scores
    const components = {
      weather: this.scoreWeather(outfit, derived),
      occasion: this.scoreOccasion(outfit, occasion, vibe),
      color: this.scoreColor(outfit, userProfile),
      fitBody: this.scoreFitBody(outfit, userProfile),
      brandBudget: this.scoreBrandBudget(
        items,
        userProfile.brand_prefs || [],
        budget,
      ),
      trend: this.scoreTrend(outfit, trendTags),
    };

    // Compute weighted sum
    const weightedSum =
      WEIGHTS.weather * components.weather +
      WEIGHTS.occasion * components.occasion +
      WEIGHTS.color * components.color +
      WEIGHTS.fitBody * components.fitBody +
      WEIGHTS.brandBudget * components.brandBudget +
      WEIGHTS.trend * components.trend;

    // Optional: blend small % of model's suggestion to break ties
    let finalScore: number;
    if (outfit.score_suggestion !== undefined && outfit.score_suggestion !== null) {
      finalScore = 0.95 * weightedSum + 0.05 * outfit.score_suggestion;
    } else {
      finalScore = weightedSum;
    }

    // Round to 2 decimal places
    finalScore = Math.round(finalScore * 100) / 100;

    this.logger.debug(
      `Scored outfit "${outfit.name}": ${finalScore} (weather: ${components.weather}, occasion: ${components.occasion}, color: ${components.color}, fit: ${components.fitBody}, budget: ${components.brandBudget}, trend: ${components.trend})`,
    );

    return {
      finalScore,
      components,
    };
  }

  /**
   * Score multiple outfits and sort by score descending
   */
  scoreAndRankOutfits(
    outfits: OutfitData[],
    ctx: ScoringContext,
  ): Array<OutfitData & { score: number; scoreComponents: ScoringResult['components'] }> {
    return outfits
      .map((outfit) => {
        const result = this.finalScore(outfit, outfit.items || [], ctx);
        return {
          ...outfit,
          score: result.finalScore,
          scoreComponents: result.components,
        };
      })
      .sort((a, b) => b.score - a.score);
  }
}
