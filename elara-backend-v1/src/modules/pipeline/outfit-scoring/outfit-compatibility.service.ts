import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from '../embeddings/embedding.service';
import { WardrobeCategory } from '../../wardrobe/domain/enums/wardrobe-category.enum';
import { Pattern } from '../../wardrobe/domain/enums/pattern.enum';
import { Occasion } from '../../wardrobe/domain/enums/occasion.enum';
import { Season } from '../../wardrobe/domain/enums/season.enum';

/**
 * Outfit Compatibility Service
 *
 * Scores outfit combinations based on multiple factors:
 * - Color harmony (complementary, analogous, etc.)
 * - Pattern mixing rules
 * - Category completeness (top + bottom)
 * - Style cohesion
 * - Occasion appropriateness
 * - Seasonal suitability
 * - Vector similarity (semantic compatibility)
 *
 * Uses both rule-based scoring and vector embeddings
 * for holistic outfit evaluation.
 */

export interface WardrobeItemInfo {
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

export interface CompatibilityScore {
  overall: number; // 0-1 total score
  components: {
    colorHarmony: number;
    patternBalance: number;
    categoryCompleteness: number;
    styleCohesion: number;
    occasionMatch: number;
    seasonMatch: number;
    semanticSimilarity: number;
  };
  issues: string[]; // Potential issues with the outfit
  suggestions: string[]; // Improvement suggestions
  confidence: number; // Confidence in the scoring
}

export interface OutfitSuggestion {
  missingCategory: WardrobeCategory;
  reason: string;
  preferredAttributes?: {
    colors?: string[];
    patterns?: Pattern[];
    styles?: string[];
  };
}

// Category groupings for completeness checking
const CATEGORY_GROUPS = {
  tops: [
    WardrobeCategory.TSHIRT,
    WardrobeCategory.SHIRT,
    WardrobeCategory.BLOUSE,
    WardrobeCategory.TANK_TOP,
    WardrobeCategory.CROP_TOP,
    WardrobeCategory.SWEATER,
    WardrobeCategory.HOODIE,
    WardrobeCategory.SWEATSHIRT,
    WardrobeCategory.CARDIGAN,
  ],
  bottoms: [
    WardrobeCategory.JEANS,
    WardrobeCategory.PANTS,
    WardrobeCategory.SHORTS,
    WardrobeCategory.SKIRT,
    WardrobeCategory.LEGGINGS,
    WardrobeCategory.JOGGERS,
  ],
  onePiece: [
    WardrobeCategory.DRESS,
    WardrobeCategory.JUMPSUIT,
    WardrobeCategory.ROMPER,
  ],
  outerwear: [
    WardrobeCategory.JACKET,
    WardrobeCategory.COAT,
    WardrobeCategory.BLAZER,
    WardrobeCategory.VEST,
    WardrobeCategory.PARKA,
  ],
  footwear: [
    WardrobeCategory.SNEAKERS,
    WardrobeCategory.BOOTS,
    WardrobeCategory.SANDALS,
    WardrobeCategory.HEELS,
    WardrobeCategory.FLATS,
    WardrobeCategory.LOAFERS,
  ],
  accessories: [
    WardrobeCategory.BAG,
    WardrobeCategory.BACKPACK,
    WardrobeCategory.BELT,
    WardrobeCategory.HAT,
    WardrobeCategory.SCARF,
    WardrobeCategory.SUNGLASSES,
    WardrobeCategory.JEWELRY,
    WardrobeCategory.WATCH,
  ],
};

// Pattern compatibility rules
const PATTERN_COMPATIBILITY: Record<Pattern, Pattern[]> = {
  [Pattern.SOLID]: Object.values(Pattern), // Solid goes with everything
  [Pattern.STRIPED]: [Pattern.SOLID, Pattern.POLKA_DOT],
  [Pattern.CHECKED]: [Pattern.SOLID, Pattern.STRIPED],
  [Pattern.PLAID]: [Pattern.SOLID],
  [Pattern.POLKA_DOT]: [Pattern.SOLID, Pattern.STRIPED],
  [Pattern.PRINTED]: [Pattern.SOLID],
  [Pattern.FLORAL]: [Pattern.SOLID, Pattern.STRIPED],
  [Pattern.ABSTRACT]: [Pattern.SOLID],
  [Pattern.GEOMETRIC]: [Pattern.SOLID],
  [Pattern.ANIMAL_PRINT]: [Pattern.SOLID],
  [Pattern.TIE_DYE]: [Pattern.SOLID],
  [Pattern.CAMO]: [Pattern.SOLID],
};

@Injectable()
export class OutfitCompatibilityService {
  private readonly logger = new Logger(OutfitCompatibilityService.name);

  // Scoring weights
  private readonly WEIGHTS = {
    colorHarmony: 0.20,
    patternBalance: 0.15,
    categoryCompleteness: 0.20,
    styleCohesion: 0.15,
    occasionMatch: 0.10,
    seasonMatch: 0.10,
    semanticSimilarity: 0.10,
  };

  constructor(private embeddingService: EmbeddingService) {}

  /**
   * Score an outfit combination
   */
  async scoreOutfit(items: WardrobeItemInfo[]): Promise<CompatibilityScore> {
    if (items.length === 0) {
      return this.emptyScore('No items in outfit');
    }

    if (items.length === 1) {
      return this.singleItemScore(items[0]);
    }

    const issues: string[] = [];
    const suggestions: string[] = [];

    // Calculate component scores
    const colorHarmony = this.calculateColorHarmony(items, issues, suggestions);
    const patternBalance = this.calculatePatternBalance(items, issues, suggestions);
    const categoryCompleteness = this.calculateCategoryCompleteness(items, issues, suggestions);
    const styleCohesion = this.calculateStyleCohesion(items, issues, suggestions);
    const occasionMatch = this.calculateOccasionMatch(items, issues, suggestions);
    const seasonMatch = this.calculateSeasonMatch(items, issues, suggestions);
    const semanticSimilarity = await this.calculateSemanticSimilarity(items);

    // Calculate weighted overall score
    const overall =
      colorHarmony * this.WEIGHTS.colorHarmony +
      patternBalance * this.WEIGHTS.patternBalance +
      categoryCompleteness * this.WEIGHTS.categoryCompleteness +
      styleCohesion * this.WEIGHTS.styleCohesion +
      occasionMatch * this.WEIGHTS.occasionMatch +
      seasonMatch * this.WEIGHTS.seasonMatch +
      semanticSimilarity * this.WEIGHTS.semanticSimilarity;

    // Calculate confidence based on available data
    const confidence = this.calculateConfidence(items);

    return {
      overall: Math.round(overall * 100) / 100,
      components: {
        colorHarmony: Math.round(colorHarmony * 100) / 100,
        patternBalance: Math.round(patternBalance * 100) / 100,
        categoryCompleteness: Math.round(categoryCompleteness * 100) / 100,
        styleCohesion: Math.round(styleCohesion * 100) / 100,
        occasionMatch: Math.round(occasionMatch * 100) / 100,
        seasonMatch: Math.round(seasonMatch * 100) / 100,
        semanticSimilarity: Math.round(semanticSimilarity * 100) / 100,
      },
      issues,
      suggestions,
      confidence,
    };
  }

  /**
   * Get suggestions for completing an outfit
   */
  getSuggestions(items: WardrobeItemInfo[]): OutfitSuggestion[] {
    const suggestions: OutfitSuggestion[] = [];
    const categories = items.map((i) => i.category);

    const hasTop = categories.some((c) => CATEGORY_GROUPS.tops.includes(c));
    const hasBottom = categories.some((c) => CATEGORY_GROUPS.bottoms.includes(c));
    const hasOnePiece = categories.some((c) => CATEGORY_GROUPS.onePiece.includes(c));
    const hasFootwear = categories.some((c) => CATEGORY_GROUPS.footwear.includes(c));

    // Check for missing core pieces
    if (!hasOnePiece) {
      if (!hasTop) {
        suggestions.push({
          missingCategory: WardrobeCategory.TSHIRT,
          reason: 'Outfit needs a top to be complete',
          preferredAttributes: this.getPreferredAttributes(items, 'top'),
        });
      }

      if (!hasBottom) {
        suggestions.push({
          missingCategory: WardrobeCategory.JEANS,
          reason: 'Outfit needs a bottom to be complete',
          preferredAttributes: this.getPreferredAttributes(items, 'bottom'),
        });
      }
    }

    if (!hasFootwear) {
      suggestions.push({
        missingCategory: WardrobeCategory.SNEAKERS,
        reason: 'Consider adding footwear to complete the look',
        preferredAttributes: this.getPreferredAttributes(items, 'footwear'),
      });
    }

    return suggestions;
  }

  /**
   * Find best matching items from a collection
   */
  async findBestMatches(
    currentItems: WardrobeItemInfo[],
    candidateItems: WardrobeItemInfo[],
    limit: number = 5,
  ): Promise<Array<{ item: WardrobeItemInfo; score: number; reasons: string[] }>> {
    const matches: Array<{ item: WardrobeItemInfo; score: number; reasons: string[] }> = [];

    for (const candidate of candidateItems) {
      // Skip if already in outfit
      if (currentItems.some((i) => i.id === candidate.id)) {
        continue;
      }

      const testOutfit = [...currentItems, candidate];
      const score = await this.scoreOutfit(testOutfit);

      const reasons: string[] = [];

      // Add reasons why this item matches
      if (score.components.colorHarmony > 0.7) {
        reasons.push('Colors complement well');
      }
      if (score.components.patternBalance > 0.8) {
        reasons.push('Pattern balance is good');
      }
      if (score.components.styleCohesion > 0.7) {
        reasons.push('Style matches the outfit');
      }

      matches.push({
        item: candidate,
        score: score.overall,
        reasons,
      });
    }

    // Sort by score and return top matches
    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Calculate color harmony score
   */
  private calculateColorHarmony(
    items: WardrobeItemInfo[],
    issues: string[],
    suggestions: string[],
  ): number {
    const colors = items
      .filter((i) => i.dominantColor)
      .map((i) => i.dominantColor!);

    if (colors.length === 0) {
      return 0.7; // Default when no color data
    }

    // Convert hex colors to HSL for analysis
    const hslColors = colors.map((c) => this.hexToHsl(c));

    // Check for color harmony
    let score = 0.5; // Base score

    // Monochromatic: similar hues
    const hues = hslColors.map((c) => c.h);
    const hueRange = Math.max(...hues) - Math.min(...hues);

    if (hueRange < 30) {
      score += 0.3; // Monochromatic bonus
    } else if (this.areComplementary(hues)) {
      score += 0.25; // Complementary bonus
    } else if (this.areAnalogous(hues)) {
      score += 0.2; // Analogous bonus
    }

    // Neutral colors always work
    const neutralCount = hslColors.filter((c) => c.s < 0.1).length;
    score += neutralCount * 0.05;

    // Clashing colors penalty
    if (this.hasClashingColors(hslColors)) {
      score -= 0.2;
      issues.push('Some colors may clash');
      suggestions.push('Consider adding a neutral piece to balance the colors');
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Calculate pattern balance score
   */
  private calculatePatternBalance(
    items: WardrobeItemInfo[],
    issues: string[],
    suggestions: string[],
  ): number {
    const patterns = items
      .filter((i) => i.pattern)
      .map((i) => i.pattern!);

    if (patterns.length === 0) {
      return 0.8; // Default when no pattern data
    }

    // Count non-solid patterns
    const nonSolidPatterns = patterns.filter((p) => p !== Pattern.SOLID);

    // Multiple bold patterns can clash
    if (nonSolidPatterns.length > 2) {
      issues.push('Too many patterns may be overwhelming');
      suggestions.push('Consider replacing one pattern with a solid piece');
      return 0.4;
    }

    // Check pattern compatibility
    if (nonSolidPatterns.length === 2) {
      const [p1, p2] = nonSolidPatterns;
      const compatible = PATTERN_COMPATIBILITY[p1]?.includes(p2);

      if (!compatible) {
        issues.push(`${p1} and ${p2} patterns may not pair well`);
        return 0.5;
      }
    }

    // One pattern with solids is ideal
    if (nonSolidPatterns.length === 1) {
      return 0.95;
    }

    // All solids is fine but less interesting
    if (nonSolidPatterns.length === 0) {
      suggestions.push('Adding one patterned piece could add visual interest');
      return 0.75;
    }

    return 0.8;
  }

  /**
   * Calculate category completeness score
   */
  private calculateCategoryCompleteness(
    items: WardrobeItemInfo[],
    issues: string[],
    suggestions: string[],
  ): number {
    const categories = items.map((i) => i.category);

    const hasTop = categories.some((c) => CATEGORY_GROUPS.tops.includes(c));
    const hasBottom = categories.some((c) => CATEGORY_GROUPS.bottoms.includes(c));
    const hasOnePiece = categories.some((c) => CATEGORY_GROUPS.onePiece.includes(c));
    const hasFootwear = categories.some((c) => CATEGORY_GROUPS.footwear.includes(c));
    const hasOuterwear = categories.some((c) => CATEGORY_GROUPS.outerwear.includes(c));

    let score = 0;

    // Core requirement: top+bottom OR one-piece
    if (hasOnePiece) {
      score += 0.5;
    } else if (hasTop && hasBottom) {
      score += 0.5;
    } else {
      if (!hasTop && !hasOnePiece) {
        issues.push('Missing a top');
        suggestions.push('Add a shirt, t-shirt, or blouse');
      }
      if (!hasBottom && !hasOnePiece) {
        issues.push('Missing a bottom');
        suggestions.push('Add pants, jeans, or a skirt');
      }
      score += 0.2; // Partial credit
    }

    // Footwear bonus
    if (hasFootwear) {
      score += 0.3;
    } else {
      suggestions.push('Consider adding footwear');
    }

    // Outerwear bonus (optional)
    if (hasOuterwear) {
      score += 0.1;
    }

    // Accessories bonus (optional)
    const accessoryCount = categories.filter((c) =>
      CATEGORY_GROUPS.accessories.includes(c),
    ).length;
    score += Math.min(accessoryCount * 0.05, 0.1);

    return Math.min(1, score);
  }

  /**
   * Calculate style cohesion score
   */
  private calculateStyleCohesion(
    items: WardrobeItemInfo[],
    issues: string[],
    suggestions: string[],
  ): number {
    const allStyles = items
      .filter((i) => i.style && i.style.length > 0)
      .flatMap((i) => i.style!);

    if (allStyles.length === 0) {
      return 0.7; // Default when no style data
    }

    // Count style occurrences
    const styleCounts = new Map<string, number>();
    for (const style of allStyles) {
      styleCounts.set(style, (styleCounts.get(style) || 0) + 1);
    }

    // Find dominant style
    const sortedStyles = Array.from(styleCounts.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    const dominantStyle = sortedStyles[0];
    const dominantRatio = dominantStyle[1] / items.length;

    // High cohesion if most items share a style
    if (dominantRatio >= 0.7) {
      return 0.95;
    }

    if (dominantRatio >= 0.5) {
      return 0.8;
    }

    // Check for incompatible style mixing
    const hasConflict = this.hasStyleConflict(Array.from(styleCounts.keys()));
    if (hasConflict) {
      issues.push('Mixed styles may not work together');
      suggestions.push('Try sticking to a cohesive style theme');
      return 0.4;
    }

    return 0.65;
  }

  /**
   * Calculate occasion match score
   */
  private calculateOccasionMatch(
    items: WardrobeItemInfo[],
    issues: string[],
    suggestions: string[],
  ): number {
    const allOccasions = items
      .filter((i) => i.occasion && i.occasion.length > 0)
      .flatMap((i) => i.occasion!);

    if (allOccasions.length === 0) {
      return 0.7; // Default
    }

    // Find common occasions
    const occasionCounts = new Map<Occasion, number>();
    for (const occasion of allOccasions) {
      occasionCounts.set(occasion, (occasionCounts.get(occasion) || 0) + 1);
    }

    // Check if items share occasions
    const itemsWithOccasion = items.filter(
      (i) => i.occasion && i.occasion.length > 0,
    ).length;
    const maxShared = Math.max(...Array.from(occasionCounts.values()));
    const sharedRatio = maxShared / itemsWithOccasion;

    if (sharedRatio >= 0.8) {
      return 0.95;
    }

    if (sharedRatio >= 0.5) {
      return 0.75;
    }

    issues.push('Items may be suited for different occasions');
    return 0.5;
  }

  /**
   * Calculate season match score
   */
  private calculateSeasonMatch(
    items: WardrobeItemInfo[],
    issues: string[],
    suggestions: string[],
  ): number {
    const allSeasons = items
      .filter((i) => i.season && i.season.length > 0)
      .flatMap((i) => i.season!);

    if (allSeasons.length === 0) {
      return 0.7; // Default
    }

    // Find common seasons
    const seasonCounts = new Map<Season, number>();
    for (const season of allSeasons) {
      seasonCounts.set(season, (seasonCounts.get(season) || 0) + 1);
    }

    const itemsWithSeason = items.filter(
      (i) => i.season && i.season.length > 0,
    ).length;
    const maxShared = Math.max(...Array.from(seasonCounts.values()));
    const sharedRatio = maxShared / itemsWithSeason;

    if (sharedRatio >= 0.8) {
      return 0.95;
    }

    if (sharedRatio >= 0.5) {
      return 0.75;
    }

    // Check for season conflicts (e.g., winter coat with summer shorts)
    const hasWinter = seasonCounts.has(Season.WINTER);
    const hasSummer = seasonCounts.has(Season.SUMMER);
    if (hasWinter && hasSummer) {
      issues.push('Mixed summer and winter items');
      return 0.3;
    }

    return 0.6;
  }

  /**
   * Calculate semantic similarity using embeddings
   */
  private async calculateSemanticSimilarity(
    items: WardrobeItemInfo[],
  ): Promise<number> {
    const embeddings = items
      .filter((i) => i.embedding && i.embedding.length > 0)
      .map((i) => i.embedding!);

    if (embeddings.length < 2) {
      return 0.7; // Default when insufficient embedding data
    }

    // Calculate average pairwise similarity
    let totalSimilarity = 0;
    let pairCount = 0;

    for (let i = 0; i < embeddings.length; i++) {
      for (let j = i + 1; j < embeddings.length; j++) {
        const similarity = this.embeddingService.cosineSimilarity(
          embeddings[i],
          embeddings[j],
        );
        totalSimilarity += similarity;
        pairCount++;
      }
    }

    const avgSimilarity = pairCount > 0 ? totalSimilarity / pairCount : 0.7;

    // Normalize: we want some similarity but not too much (variety is good)
    // Ideal range is 0.5-0.8 similarity
    if (avgSimilarity >= 0.5 && avgSimilarity <= 0.8) {
      return 0.9 + (avgSimilarity - 0.5) * 0.2;
    }

    if (avgSimilarity > 0.8) {
      // Too similar - items might be redundant
      return 0.7;
    }

    // Low similarity might indicate mismatch
    return Math.max(0.5, avgSimilarity + 0.3);
  }

  /**
   * Calculate confidence based on available data
   */
  private calculateConfidence(items: WardrobeItemInfo[]): number {
    let dataPoints = 0;
    let totalPossible = items.length * 6; // 6 attributes we check

    for (const item of items) {
      if (item.dominantColor) dataPoints++;
      if (item.pattern) dataPoints++;
      if (item.style && item.style.length > 0) dataPoints++;
      if (item.occasion && item.occasion.length > 0) dataPoints++;
      if (item.season && item.season.length > 0) dataPoints++;
      if (item.embedding && item.embedding.length > 0) dataPoints++;
    }

    return Math.round((dataPoints / totalPossible) * 100) / 100;
  }

  /**
   * Get preferred attributes for completing an outfit
   */
  private getPreferredAttributes(
    items: WardrobeItemInfo[],
    targetType: 'top' | 'bottom' | 'footwear',
  ): OutfitSuggestion['preferredAttributes'] {
    // Analyze existing items to suggest compatible attributes
    const colors = items
      .filter((i) => i.dominantColor)
      .map((i) => i.dominantColor!);

    const patterns = items
      .filter((i) => i.pattern)
      .map((i) => i.pattern!);

    const hasPattern = patterns.some((p) => p !== Pattern.SOLID);

    return {
      colors: this.getComplementaryColors(colors),
      patterns: hasPattern ? [Pattern.SOLID] : undefined,
      styles: this.getDominantStyles(items),
    };
  }

  /**
   * Get complementary colors
   */
  private getComplementaryColors(existingColors: string[]): string[] {
    // Return neutral colors as safe suggestions
    const neutrals = ['#000000', '#FFFFFF', '#808080', '#D3D3D3', '#2F4F4F'];

    if (existingColors.length === 0) {
      return neutrals;
    }

    // For now, return neutrals as safe choices
    // Future: implement color wheel logic
    return neutrals;
  }

  /**
   * Get dominant styles from items
   */
  private getDominantStyles(items: WardrobeItemInfo[]): string[] {
    const allStyles = items
      .filter((i) => i.style && i.style.length > 0)
      .flatMap((i) => i.style!);

    if (allStyles.length === 0) {
      return [];
    }

    const styleCounts = new Map<string, number>();
    for (const style of allStyles) {
      styleCounts.set(style, (styleCounts.get(style) || 0) + 1);
    }

    return Array.from(styleCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([style]) => style);
  }

  /**
   * Convert hex color to HSL
   */
  private hexToHsl(hex: string): { h: number; s: number; l: number } {
    // Remove # if present
    hex = hex.replace(/^#/, '');

    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    let h = 0;
    let s = 0;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch (max) {
        case r:
          h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
          break;
        case g:
          h = ((b - r) / d + 2) / 6;
          break;
        case b:
          h = ((r - g) / d + 4) / 6;
          break;
      }
    }

    return { h: h * 360, s, l };
  }

  /**
   * Check if colors are complementary
   */
  private areComplementary(hues: number[]): boolean {
    if (hues.length < 2) return false;

    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const diff = Math.abs(hues[i] - hues[j]);
        if (diff >= 150 && diff <= 210) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if colors are analogous
   */
  private areAnalogous(hues: number[]): boolean {
    if (hues.length < 2) return false;

    const sortedHues = [...hues].sort((a, b) => a - b);
    const range = sortedHues[sortedHues.length - 1] - sortedHues[0];

    return range <= 60;
  }

  /**
   * Check for clashing colors
   */
  private hasClashingColors(
    colors: Array<{ h: number; s: number; l: number }>,
  ): boolean {
    // Multiple saturated colors with non-harmonious hues can clash
    const saturatedColors = colors.filter((c) => c.s > 0.5);

    if (saturatedColors.length < 2) return false;

    for (let i = 0; i < saturatedColors.length; i++) {
      for (let j = i + 1; j < saturatedColors.length; j++) {
        const hueDiff = Math.abs(saturatedColors[i].h - saturatedColors[j].h);
        // Colors that are neither complementary nor analogous tend to clash
        if (hueDiff > 30 && hueDiff < 150) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check for style conflicts
   */
  private hasStyleConflict(styles: string[]): boolean {
    const conflictingPairs = [
      ['formal', 'streetwear'],
      ['formal', 'athletic'],
      ['gothic', 'preppy'],
      ['bohemian', 'minimalist'],
    ];

    for (const [s1, s2] of conflictingPairs) {
      if (styles.includes(s1) && styles.includes(s2)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Empty score for invalid outfits
   */
  private emptyScore(reason: string): CompatibilityScore {
    return {
      overall: 0,
      components: {
        colorHarmony: 0,
        patternBalance: 0,
        categoryCompleteness: 0,
        styleCohesion: 0,
        occasionMatch: 0,
        seasonMatch: 0,
        semanticSimilarity: 0,
      },
      issues: [reason],
      suggestions: ['Add items to create an outfit'],
      confidence: 0,
    };
  }

  /**
   * Score for single item
   */
  private singleItemScore(item: WardrobeItemInfo): CompatibilityScore {
    return {
      overall: 0.3,
      components: {
        colorHarmony: 1,
        patternBalance: 1,
        categoryCompleteness: 0.2,
        styleCohesion: 1,
        occasionMatch: 1,
        seasonMatch: 1,
        semanticSimilarity: 1,
      },
      issues: ['Outfit has only one item'],
      suggestions: this.getSuggestions([item]).map((s) => s.reason),
      confidence: 0.5,
    };
  }
}
