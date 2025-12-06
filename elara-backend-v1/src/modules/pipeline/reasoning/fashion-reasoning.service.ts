import { Injectable, Logger, Optional } from '@nestjs/common';
import { ClaudeService } from '../infrastructure/llm/claude.service';

/**
 * Color pairing request context
 */
export interface ColorPairingContext {
  baseColor: string;
  itemType: string;
  occasion?: string;
  existingOutfitColors?: string[];
  userPreferences?: {
    preferredColors?: string[];
    avoidColors?: string[];
  };
  season?: string;
}

/**
 * Color pairing result from LLM
 */
export interface ColorPairingResult {
  recommendedColors: string[];
  avoidColors: string[];
  reasoning: string;
  harmony: string; // e.g., "complementary", "analogous", "monochromatic"
}

/**
 * Outfit scoring context
 */
export interface OutfitScoringContext {
  occasion: string;
  weather?: {
    temperature?: number;
    condition?: string;
    humidity?: number;
  };
  userProfile?: {
    gender?: string;
    style?: string;
    bodyType?: string;
  };
  venue?: string;
}

/**
 * Outfit scoring result from LLM
 */
export interface OutfitScoringResult {
  score: number; // 0-10
  breakdown: {
    colorHarmony: number;
    occasionFit: number;
    styleCoherence: number;
    weatherAppropriateness: number;
    trendAlignment: number;
  };
  reasoning: string;
  improvements: string[];
}

/**
 * Safety validation context
 */
export interface SafetyValidationContext {
  weather?: {
    temperature?: number;
    condition?: string;
    precipitation?: number;
  };
  venue: string;
  occasion: string;
  culturalContext?: string;
}

/**
 * Safety validation result
 */
export interface SafetyValidationResult {
  isSafe: boolean;
  concerns: string[];
  suggestions: string[];
  severity: 'low' | 'medium' | 'high';
}

/**
 * Fashion Reasoning Service
 *
 * Provides LLM-based fashion reasoning to replace hardcoded logic:
 * - Color pairing recommendations (replaces 133+ hardcoded pairings)
 * - Outfit scoring with explanations
 * - Safety and cultural validation
 *
 * This service uses Claude for dynamic reasoning about fashion
 * instead of rigid rules that can't handle infinite combinations.
 */
@Injectable()
export class FashionReasoningService {
  private readonly logger = new Logger(FashionReasoningService.name);

  // Fallback color pairings when LLM is unavailable
  private readonly fallbackColorPairings: Record<string, string[]> = {
    black: ['white', 'red', 'gold', 'silver', 'cream', 'blush', 'navy'],
    white: ['black', 'navy', 'red', 'blue', 'pink', 'any'],
    navy: ['white', 'cream', 'gold', 'blush', 'coral', 'burgundy'],
    beige: ['white', 'navy', 'brown', 'olive', 'burgundy', 'teal'],
    gray: ['pink', 'blue', 'purple', 'yellow', 'red', 'black', 'white'],
    red: ['black', 'white', 'navy', 'beige', 'gray'],
    blue: ['white', 'beige', 'gray', 'orange', 'pink', 'navy'],
    green: ['white', 'beige', 'brown', 'navy', 'cream', 'gold'],
    pink: ['gray', 'navy', 'black', 'white', 'cream', 'burgundy'],
    burgundy: ['cream', 'beige', 'navy', 'pink', 'gold', 'olive'],
  };

  constructor(
    @Optional() private claudeService?: ClaudeService,
  ) {}

  /**
   * Get color pairing recommendations using LLM
   * Replaces hardcoded color-pairing.service.ts logic
   */
  async getColorPairingRecommendations(
    context: ColorPairingContext,
  ): Promise<ColorPairingResult> {
    // Try LLM-based reasoning first
    if (this.claudeService) {
      try {
        return await this.llmColorPairing(context);
      } catch (error) {
        this.logger.warn(
          `LLM color pairing failed: ${(error as Error).message}, using fallback`,
        );
      }
    }

    // Fallback to basic color rules
    return this.fallbackColorPairing(context);
  }

  /**
   * LLM-based color pairing logic
   */
  private async llmColorPairing(context: ColorPairingContext): Promise<ColorPairingResult> {
    const prompt = `As a professional fashion stylist, recommend colors that pair well with a ${context.baseColor} ${context.itemType}.

Context:
- Base color: ${context.baseColor}
- Item type: ${context.itemType}
- Occasion: ${context.occasion || 'casual'}
${context.existingOutfitColors?.length ? `- Other colors in outfit: ${context.existingOutfitColors.join(', ')}` : ''}
${context.userPreferences?.preferredColors?.length ? `- User prefers: ${context.userPreferences.preferredColors.join(', ')}` : ''}
${context.userPreferences?.avoidColors?.length ? `- User avoids: ${context.userPreferences.avoidColors.join(', ')}` : ''}
${context.season ? `- Season: ${context.season}` : ''}

Respond with a JSON object containing:
{
  "recommendedColors": ["color1", "color2", "color3", "color4", "color5"],
  "avoidColors": ["color1", "color2"],
  "reasoning": "Brief explanation of why these colors work together",
  "harmony": "complementary|analogous|monochromatic|triadic|neutral"
}

Focus on creating versatile, stylish combinations that work for the given occasion. Consider color theory principles but prioritize practical fashion advice.`;

    const response = await this.claudeService!.generateJSON(prompt);

    // Validate response structure
    if (!response.recommendedColors || !Array.isArray(response.recommendedColors)) {
      throw new Error('Invalid color pairing response structure');
    }

    return {
      recommendedColors: response.recommendedColors.slice(0, 6),
      avoidColors: response.avoidColors || [],
      reasoning: response.reasoning || 'Colors selected for style harmony',
      harmony: response.harmony || 'neutral',
    };
  }

  /**
   * Fallback color pairing when LLM unavailable
   */
  private fallbackColorPairing(context: ColorPairingContext): ColorPairingResult {
    const baseColor = context.baseColor.toLowerCase();
    const recommended = this.fallbackColorPairings[baseColor] || ['white', 'black', 'navy', 'beige'];

    // Filter out user's avoided colors
    let filteredRecommended = recommended;
    if (context.userPreferences?.avoidColors?.length) {
      const avoidSet = new Set(context.userPreferences.avoidColors.map(c => c.toLowerCase()));
      filteredRecommended = recommended.filter(c => !avoidSet.has(c));
    }

    // Prioritize user's preferred colors if they're in the list
    if (context.userPreferences?.preferredColors?.length) {
      const preferredSet = new Set(context.userPreferences.preferredColors.map(c => c.toLowerCase()));
      filteredRecommended.sort((a, b) => {
        const aPreferred = preferredSet.has(a) ? -1 : 0;
        const bPreferred = preferredSet.has(b) ? -1 : 0;
        return aPreferred - bPreferred;
      });
    }

    return {
      recommendedColors: filteredRecommended.slice(0, 5),
      avoidColors: context.userPreferences?.avoidColors || [],
      reasoning: `Classic color combinations for ${baseColor}`,
      harmony: 'neutral',
    };
  }

  /**
   * Score an outfit using LLM reasoning
   * Provides detailed breakdown and improvement suggestions
   */
  async scoreOutfitWithReasoning(
    outfitItems: Array<{ name: string; color?: string; category?: string; brand?: string }>,
    context: OutfitScoringContext,
  ): Promise<OutfitScoringResult> {
    if (!this.claudeService) {
      return this.fallbackOutfitScoring(outfitItems, context);
    }

    try {
      const itemsList = outfitItems
        .map((item) => `- ${item.name}${item.color ? ` (${item.color})` : ''}`)
        .join('\n');

      const prompt = `As a professional fashion stylist, score this outfit on a scale of 0-10.

OUTFIT ITEMS:
${itemsList}

CONTEXT:
- Occasion: ${context.occasion}
${context.weather ? `- Weather: ${context.weather.temperature}°F, ${context.weather.condition}` : ''}
${context.venue ? `- Venue: ${context.venue}` : ''}
${context.userProfile?.style ? `- User style: ${context.userProfile.style}` : ''}

Respond with a JSON object:
{
  "score": <number 0-10>,
  "breakdown": {
    "colorHarmony": <number 0-10>,
    "occasionFit": <number 0-10>,
    "styleCoherence": <number 0-10>,
    "weatherAppropriateness": <number 0-10>,
    "trendAlignment": <number 0-10>
  },
  "reasoning": "Brief explanation of the score",
  "improvements": ["suggestion1", "suggestion2"]
}

Be constructive but honest. Consider how well the items work together and for the occasion.`;

      const response = await this.claudeService.generateJSON(prompt);

      return {
        score: Math.min(10, Math.max(0, response.score || 5)),
        breakdown: {
          colorHarmony: response.breakdown?.colorHarmony || 5,
          occasionFit: response.breakdown?.occasionFit || 5,
          styleCoherence: response.breakdown?.styleCoherence || 5,
          weatherAppropriateness: response.breakdown?.weatherAppropriateness || 5,
          trendAlignment: response.breakdown?.trendAlignment || 5,
        },
        reasoning: response.reasoning || 'Outfit scored based on overall style and occasion fit',
        improvements: response.improvements || [],
      };
    } catch (error) {
      this.logger.warn(`LLM outfit scoring failed: ${(error as Error).message}`);
      return this.fallbackOutfitScoring(outfitItems, context);
    }
  }

  /**
   * Fallback outfit scoring
   */
  private fallbackOutfitScoring(
    outfitItems: Array<{ name: string; color?: string; category?: string }>,
    context: OutfitScoringContext,
  ): OutfitScoringResult {
    // Basic scoring based on item count and variety
    const hasTop = outfitItems.some((i) =>
      i.category?.toLowerCase().includes('top') ||
      i.name.toLowerCase().includes('shirt') ||
      i.name.toLowerCase().includes('blouse')
    );
    const hasBottom = outfitItems.some((i) =>
      i.category?.toLowerCase().includes('bottom') ||
      i.name.toLowerCase().includes('pants') ||
      i.name.toLowerCase().includes('skirt')
    );
    const hasShoes = outfitItems.some((i) =>
      i.category?.toLowerCase().includes('shoe') ||
      i.name.toLowerCase().includes('shoe') ||
      i.name.toLowerCase().includes('heel') ||
      i.name.toLowerCase().includes('boot')
    );

    let baseScore = 5;
    if (hasTop) baseScore += 1;
    if (hasBottom) baseScore += 1;
    if (hasShoes) baseScore += 1;
    if (outfitItems.length >= 4) baseScore += 0.5;
    if (outfitItems.length >= 5) baseScore += 0.5;

    return {
      score: Math.min(10, baseScore),
      breakdown: {
        colorHarmony: 6,
        occasionFit: 6,
        styleCoherence: 6,
        weatherAppropriateness: 6,
        trendAlignment: 5,
      },
      reasoning: 'Outfit contains essential items for a complete look',
      improvements: [],
    };
  }

  /**
   * Validate outfit for safety and cultural appropriateness
   */
  async validateOutfitSafety(
    outfitItems: Array<{ name: string; category?: string }>,
    context: SafetyValidationContext,
  ): Promise<SafetyValidationResult> {
    if (!this.claudeService) {
      return this.fallbackSafetyValidation(outfitItems, context);
    }

    try {
      const itemsList = outfitItems.map((item) => `- ${item.name}`).join('\n');

      const prompt = `As a fashion consultant, evaluate this outfit for safety and appropriateness.

OUTFIT:
${itemsList}

CONTEXT:
- Venue: ${context.venue}
- Occasion: ${context.occasion}
${context.weather ? `- Weather: ${context.weather.temperature}°F, ${context.weather.condition}${context.weather.precipitation ? `, ${context.weather.precipitation > 0.3 ? 'rainy' : 'dry'}` : ''}` : ''}
${context.culturalContext ? `- Cultural context: ${context.culturalContext}` : ''}

Check for:
1. Weather safety (e.g., high heels in snow, no coat in winter, heavy fabrics in heat)
2. Venue appropriateness (e.g., modest dress for religious venues, professional for office)
3. Activity suitability (e.g., restrictive clothing for active events)
4. Cultural sensitivity

Respond with JSON:
{
  "isSafe": true/false,
  "concerns": ["concern1", "concern2"],
  "suggestions": ["alternative1", "alternative2"],
  "severity": "low|medium|high"
}

Be practical and focus on genuine safety/appropriateness issues, not style preferences.`;

      const response = await this.claudeService.generateJSON(prompt);

      return {
        isSafe: response.isSafe !== false,
        concerns: response.concerns || [],
        suggestions: response.suggestions || [],
        severity: response.severity || 'low',
      };
    } catch (error) {
      this.logger.warn(`LLM safety validation failed: ${(error as Error).message}`);
      return this.fallbackSafetyValidation(outfitItems, context);
    }
  }

  /**
   * Fallback safety validation
   */
  private fallbackSafetyValidation(
    outfitItems: Array<{ name: string; category?: string }>,
    context: SafetyValidationContext,
  ): SafetyValidationResult {
    const concerns: string[] = [];
    const suggestions: string[] = [];

    // Basic weather checks
    if (context.weather) {
      const temp = context.weather.temperature || 70;
      const hasCoat = outfitItems.some((i) =>
        i.name.toLowerCase().includes('coat') ||
        i.name.toLowerCase().includes('jacket')
      );
      const hasHeels = outfitItems.some((i) =>
        i.name.toLowerCase().includes('heel') ||
        i.name.toLowerCase().includes('stiletto')
      );

      // Cold weather check
      if (temp < 50 && !hasCoat) {
        concerns.push('Weather is cold - consider adding a coat or jacket');
        suggestions.push('Add a warm layer for temperatures below 50°F');
      }

      // Rain + heels check
      if (context.weather.precipitation && context.weather.precipitation > 0.3 && hasHeels) {
        concerns.push('High heels may be slippery in wet conditions');
        suggestions.push('Consider flats or boots with better traction');
      }

      // Snow + heels check
      if (context.weather.condition?.toLowerCase().includes('snow') && hasHeels) {
        concerns.push('High heels are dangerous in snowy conditions');
        suggestions.push('Switch to boots with traction');
      }
    }

    // Venue appropriateness
    const venue = context.venue.toLowerCase();
    const hasSleeveless = outfitItems.some((i) =>
      i.name.toLowerCase().includes('sleeveless') ||
      i.name.toLowerCase().includes('tank') ||
      i.name.toLowerCase().includes('strapless')
    );

    if ((venue.includes('temple') || venue.includes('church') || venue.includes('mosque')) && hasSleeveless) {
      concerns.push('Sleeveless attire may not be appropriate for religious venues');
      suggestions.push('Consider adding a cardigan or shawl to cover shoulders');
    }

    if (venue.includes('office') || venue.includes('business')) {
      const hasMiniskirt = outfitItems.some((i) =>
        i.name.toLowerCase().includes('mini')
      );
      if (hasMiniskirt) {
        concerns.push('Mini skirts may not meet business dress code');
        suggestions.push('Consider knee-length or longer for professional settings');
      }
    }

    return {
      isSafe: concerns.length === 0,
      concerns,
      suggestions,
      severity: concerns.length > 1 ? 'medium' : concerns.length > 0 ? 'low' : 'low',
    };
  }

  /**
   * Get coordinating colors for existing outfit items
   * Used for slot-level editing to ensure new items coordinate
   */
  async getCoordinatingColors(
    existingColors: string[],
    slotToFill: string,
    occasion?: string,
  ): Promise<string[]> {
    if (!existingColors.length) {
      return ['black', 'white', 'navy', 'beige', 'gray'];
    }

    // Use LLM if available
    if (this.claudeService) {
      try {
        const prompt = `Given an outfit with these colors: ${existingColors.join(', ')}

What colors would work well for a ${slotToFill}${occasion ? ` for a ${occasion} occasion` : ''}?

Return a JSON array of 5 colors that would coordinate well:
["color1", "color2", "color3", "color4", "color5"]

Consider color theory and fashion principles. Include at least one neutral option.`;

        const response = await this.claudeService.generateJSON(prompt);

        if (Array.isArray(response)) {
          return response.slice(0, 5);
        }
      } catch (error) {
        this.logger.debug(`LLM coordination failed, using fallback`);
      }
    }

    // Fallback: return neutrals plus matching colors
    const result = new Set<string>(['black', 'white', 'navy']);

    // Add colors that match the existing ones
    for (const color of existingColors) {
      const matches = this.fallbackColorPairings[color.toLowerCase()];
      if (matches) {
        matches.slice(0, 2).forEach((c) => result.add(c));
      }
    }

    return Array.from(result).slice(0, 5);
  }
}
