import { Injectable, Logger } from '@nestjs/common';

/**
 * Color Pairing Service
 *
 * Professional fashion color theory implementation for intelligent color recommendations.
 * Handles "what goes with X color" queries by returning complementary colors instead of matching.
 *
 * Based on:
 * - Color wheel theory (complementary, analogous, triadic, split-complementary)
 * - Fashion industry best practices
 * - Neutral pairing rules
 * - Seasonal color palettes
 */

export interface ColorPairingResult {
  inputColor: string;
  normalizedColor: string;
  complementaryColors: string[];
  neutralColors: string[];
  accentColors: string[];
  avoidColors: string[];
  colorScheme: 'complementary' | 'analogous' | 'triadic' | 'neutral' | 'monochromatic';
  stylingTips: string[];
}

export interface ColorPairingQuery {
  existingColor: string;
  itemType?: string; // e.g., "skirt", "dress", "top"
  occasion?: string; // e.g., "casual", "formal", "work"
  style?: string; // e.g., "minimalist", "bold", "classic"
}

// Color name to hex mapping for common fashion colors
const COLOR_MAP: Record<string, string> = {
  // Neutrals
  black: '#000000',
  white: '#FFFFFF',
  cream: '#FFFDD0',
  ivory: '#FFFFF0',
  beige: '#F5F5DC',
  tan: '#D2B48C',
  camel: '#C19A6B',
  brown: '#8B4513',
  chocolate: '#7B3F00',
  cognac: '#9A463D',
  gray: '#808080',
  grey: '#808080',
  charcoal: '#36454F',
  slate: '#708090',
  silver: '#C0C0C0',

  // Blues
  blue: '#0000FF',
  navy: '#000080',
  'navy blue': '#000080',
  'royal blue': '#4169E1',
  cobalt: '#0047AB',
  teal: '#008080',
  turquoise: '#40E0D0',
  aqua: '#00FFFF',
  'sky blue': '#87CEEB',
  'baby blue': '#89CFF0',
  'powder blue': '#B0E0E6',
  denim: '#1560BD',
  indigo: '#4B0082',

  // Greens
  green: '#008000',
  olive: '#808000',
  'olive green': '#808000',
  sage: '#9DC183',
  mint: '#98FF98',
  emerald: '#50C878',
  forest: '#228B22',
  'forest green': '#228B22',
  hunter: '#355E3B',
  'hunter green': '#355E3B',
  kelly: '#4CBB17',
  'kelly green': '#4CBB17',
  lime: '#32CD32',
  khaki: '#C3B091',

  // Reds
  red: '#FF0000',
  burgundy: '#800020',
  wine: '#722F37',
  maroon: '#800000',
  crimson: '#DC143C',
  scarlet: '#FF2400',
  cherry: '#DE3163',
  raspberry: '#E30B5C',
  coral: '#FF7F50',
  rust: '#B7410E',
  terracotta: '#E2725B',
  brick: '#CB4154',

  // Pinks
  pink: '#FFC0CB',
  blush: '#DE5D83',
  'dusty pink': '#D4A5A5',
  'dusty rose': '#DCAE96',
  rose: '#FF007F',
  fuchsia: '#FF00FF',
  magenta: '#FF0090',
  mauve: '#E0B0FF',
  salmon: '#FA8072',
  'hot pink': '#FF69B4',

  // Purples
  purple: '#800080',
  lavender: '#E6E6FA',
  lilac: '#C8A2C8',
  violet: '#EE82EE',
  plum: '#DDA0DD',
  eggplant: '#614051',
  grape: '#6F2DA8',
  orchid: '#DA70D6',

  // Yellows & Oranges
  yellow: '#FFFF00',
  mustard: '#FFDB58',
  gold: '#FFD700',
  golden: '#FFD700',
  amber: '#FFBF00',
  orange: '#FFA500',
  tangerine: '#FF9966',
  peach: '#FFCBA4',
  apricot: '#FBCEB1',
  copper: '#B87333',
};

// Fashion-approved color pairings based on color theory and industry standards
const FASHION_COLOR_PAIRINGS: Record<string, { complementary: string[]; neutrals: string[]; accents: string[]; avoid: string[]; tips: string[] }> = {
  // OLIVE GREEN - Earth tone pairings
  olive: {
    complementary: ['cream', 'white', 'tan', 'camel', 'rust', 'burgundy', 'navy', 'brown', 'cognac'],
    neutrals: ['black', 'white', 'cream', 'beige', 'gray', 'charcoal'],
    accents: ['mustard', 'burnt orange', 'terracotta', 'gold'],
    avoid: ['bright green', 'lime', 'neon colors', 'bright pink'],
    tips: [
      'Olive pairs beautifully with warm earth tones like rust, terracotta, and cognac',
      'White or cream creates a fresh, clean contrast with olive',
      'Navy blue offers a sophisticated complement to olive green',
      'Avoid wearing olive with bright or neon greens - too much of the same color family',
    ],
  },

  // NAVY BLUE - Classic pairings
  navy: {
    complementary: ['white', 'cream', 'coral', 'blush', 'tan', 'camel', 'mustard', 'burgundy', 'red'],
    neutrals: ['white', 'cream', 'beige', 'gray', 'silver'],
    accents: ['gold', 'copper', 'rose gold', 'coral', 'pink'],
    avoid: ['black', 'dark brown', 'charcoal'],
    tips: [
      'Navy and white is a timeless, nautical-inspired combination',
      'Coral or blush pink adds a feminine touch to navy',
      'Mustard yellow creates a bold, fashion-forward contrast',
      'Avoid pairing navy with black unless intentionally going for a very dark look',
    ],
  },

  // RED - Bold pairings
  red: {
    complementary: ['white', 'navy', 'black', 'cream', 'beige', 'camel', 'gray'],
    neutrals: ['white', 'black', 'navy', 'beige', 'gray', 'cream'],
    accents: ['gold', 'leopard print', 'denim'],
    avoid: ['orange', 'bright pink', 'purple', 'bright green'],
    tips: [
      'Red and navy is a sophisticated, classic pairing',
      'White or cream keeps red looking fresh and polished',
      'Neutral accessories let red be the star of the outfit',
      'Avoid red with orange or hot pink - too visually competing',
    ],
  },

  // BURGUNDY/WINE - Rich pairings
  burgundy: {
    complementary: ['cream', 'tan', 'camel', 'navy', 'blush', 'olive', 'forest green', 'mustard'],
    neutrals: ['black', 'white', 'cream', 'beige', 'gray', 'charcoal'],
    accents: ['gold', 'rose gold', 'copper'],
    avoid: ['red', 'bright pink', 'orange'],
    tips: [
      'Burgundy and cream create a rich, elegant look',
      'Camel or tan adds warmth to burgundy',
      'Navy blue pairs sophisticatedly with wine tones',
      'Avoid bright reds - too similar but competing',
    ],
  },

  // BLACK - Universal pairings
  black: {
    complementary: ['white', 'cream', 'red', 'pink', 'cobalt', 'emerald', 'gold', 'silver'],
    neutrals: ['white', 'cream', 'gray', 'silver', 'gold'],
    accents: ['any bright color', 'metallics', 'leopard print'],
    avoid: ['navy', 'dark brown', 'charcoal'],
    tips: [
      'Black is universal - pairs with almost any color',
      'Black and white is the ultimate classic combination',
      'Add a pop of color with accessories for visual interest',
      'Be careful pairing black with navy or dark brown - can look unintentional',
    ],
  },

  // WHITE/CREAM - Fresh pairings
  white: {
    complementary: ['navy', 'black', 'denim', 'tan', 'camel', 'olive', 'blush', 'coral'],
    neutrals: ['black', 'navy', 'gray', 'beige', 'tan'],
    accents: ['gold', 'silver', 'any color'],
    avoid: ['cream', 'ivory', 'off-white'],
    tips: [
      'White is incredibly versatile - works with any color',
      'White and navy is fresh and nautical',
      'Earth tones like tan and olive look beautiful with white',
      'Avoid mixing different shades of white/cream in one outfit',
    ],
  },

  // PINK/BLUSH - Feminine pairings
  pink: {
    complementary: ['navy', 'gray', 'olive', 'burgundy', 'white', 'cream', 'tan', 'denim'],
    neutrals: ['white', 'cream', 'gray', 'navy', 'charcoal'],
    accents: ['gold', 'rose gold', 'silver'],
    avoid: ['red', 'orange', 'bright purple'],
    tips: [
      'Pink and navy is a sophisticated, feminine combination',
      'Gray softens pink beautifully for a refined look',
      'Olive green provides an unexpected but stunning contrast',
      'Avoid red or orange - colors compete rather than complement',
    ],
  },

  // BLUE - Versatile pairings
  blue: {
    complementary: ['white', 'cream', 'tan', 'coral', 'peach', 'yellow', 'rust', 'burgundy'],
    neutrals: ['white', 'cream', 'beige', 'gray', 'tan'],
    accents: ['gold', 'copper', 'coral', 'orange'],
    avoid: ['black', 'dark green', 'purple'],
    tips: [
      'Blue and white is classic and universally flattering',
      'Coral or orange provides a beautiful complementary contrast',
      'Tan and camel create an elegant, earthy palette',
      'Be careful with blue and black - can look too dark',
    ],
  },

  // BROWN - Earthy pairings
  brown: {
    complementary: ['cream', 'white', 'tan', 'turquoise', 'coral', 'pink', 'blue', 'rust'],
    neutrals: ['cream', 'white', 'beige', 'tan', 'camel'],
    accents: ['gold', 'turquoise', 'coral', 'orange'],
    avoid: ['black', 'navy', 'gray'],
    tips: [
      'Brown loves cream and white for a polished look',
      'Turquoise is a stunning complement to brown',
      'Stay within warm color families for cohesion',
      'Avoid pairing brown with black - generally clashes',
    ],
  },

  // GREEN - Natural pairings
  green: {
    complementary: ['white', 'cream', 'navy', 'pink', 'coral', 'burgundy', 'tan', 'brown'],
    neutrals: ['white', 'cream', 'beige', 'tan', 'black', 'gray'],
    accents: ['gold', 'copper', 'coral', 'blush'],
    avoid: ['bright green', 'lime', 'yellow-green'],
    tips: [
      'Green and navy create a sophisticated, preppy look',
      'Blush pink provides a beautiful feminine contrast',
      'Cream and white keep green looking fresh',
      'Avoid mixing different greens unless intentional',
    ],
  },

  // GRAY - Neutral pairings
  gray: {
    complementary: ['pink', 'blush', 'yellow', 'coral', 'red', 'purple', 'navy', 'teal'],
    neutrals: ['white', 'black', 'cream', 'navy'],
    accents: ['gold', 'silver', 'rose gold', 'any color'],
    avoid: ['brown', 'beige'],
    tips: [
      'Gray is extremely versatile - pairs with almost any color',
      'Pink and gray is soft and sophisticated',
      'Add a pop of yellow or coral for energy',
      'Avoid brown or beige with gray - can look muddy',
    ],
  },

  // PURPLE/LAVENDER - Elegant pairings
  purple: {
    complementary: ['gray', 'silver', 'cream', 'navy', 'blush', 'mint', 'gold'],
    neutrals: ['white', 'cream', 'gray', 'silver', 'charcoal'],
    accents: ['gold', 'silver', 'mint', 'coral'],
    avoid: ['red', 'orange', 'brown', 'bright green'],
    tips: [
      'Purple and gray create an elegant, sophisticated palette',
      'Silver accessories complement purple beautifully',
      'Cream provides a soft, romantic contrast',
      'Avoid orange and red - clashing warm tones',
    ],
  },

  // YELLOW/MUSTARD - Warm pairings
  yellow: {
    complementary: ['navy', 'gray', 'purple', 'white', 'denim', 'brown', 'burgundy'],
    neutrals: ['white', 'navy', 'gray', 'black', 'denim'],
    accents: ['gold', 'copper', 'brown'],
    avoid: ['orange', 'red', 'bright pink', 'lime'],
    tips: [
      'Yellow and navy is a classic, preppy combination',
      'Gray softens bright yellow for a wearable look',
      'Purple provides a stunning complementary contrast',
      'Avoid orange or red - too much warm intensity',
    ],
  },

  // CORAL - Vibrant pairings
  coral: {
    complementary: ['navy', 'turquoise', 'teal', 'white', 'cream', 'tan', 'gold'],
    neutrals: ['white', 'cream', 'navy', 'tan', 'beige'],
    accents: ['gold', 'turquoise', 'mint'],
    avoid: ['red', 'orange', 'pink', 'bright purple'],
    tips: [
      'Coral and navy is fresh and summery',
      'Turquoise provides a beautiful beach-inspired contrast',
      'Gold accessories enhance coral beautifully',
      'Avoid red, pink, or orange - colors compete',
    ],
  },

  // DENIM/CHAMBRAY - Casual pairings
  denim: {
    complementary: ['white', 'cream', 'red', 'coral', 'yellow', 'pink', 'olive', 'camel'],
    neutrals: ['white', 'cream', 'black', 'tan', 'gray'],
    accents: ['gold', 'silver', 'leopard print', 'any color'],
    avoid: ['similar denim shades'],
    tips: [
      'Denim is casual-versatile - pairs with almost everything',
      'White keeps denim looking fresh and crisp',
      'Red or coral adds a vibrant pop to denim',
      'Avoid wearing the same shade of denim top and bottom',
    ],
  },
};

@Injectable()
export class ColorPairingService {
  private readonly logger = new Logger(ColorPairingService.name);

  /**
   * Get color pairing recommendations for a given color
   */
  getColorPairings(query: ColorPairingQuery): ColorPairingResult {
    const normalizedColor = this.normalizeColorName(query.existingColor);

    this.logger.log(`Getting color pairings for: ${query.existingColor} -> ${normalizedColor}`);

    // Get predefined pairings or generate from color theory
    const pairings = FASHION_COLOR_PAIRINGS[normalizedColor] ||
                     this.generateColorTheoryPairings(normalizedColor);

    // Adjust recommendations based on occasion and style
    const adjustedPairings = this.adjustForContext(pairings, query);

    return {
      inputColor: query.existingColor,
      normalizedColor,
      complementaryColors: adjustedPairings.complementary,
      neutralColors: adjustedPairings.neutrals,
      accentColors: adjustedPairings.accents,
      avoidColors: adjustedPairings.avoid,
      colorScheme: this.determineColorScheme(normalizedColor, adjustedPairings.complementary),
      stylingTips: adjustedPairings.tips,
    };
  }

  /**
   * Detect if a query is asking for color pairing recommendations
   */
  detectColorPairingIntent(message: string): { isPairingQuery: boolean; existingColor?: string; itemType?: string } {
    const messageLower = message.toLowerCase();

    // Patterns that indicate color pairing queries
    const pairingPatterns = [
      /what (?:color(?:s)?|top(?:s)?|item(?:s)?|clothes?) (?:goes?|pairs?|works?|matches?|looks? good) with (?:my )?(?:an? )?(\w+(?:\s+\w+)?)\s*(?:skirt|dress|pants|top|shirt|jacket|coat|sweater)?/i,
      /(?:goes?|pairs?|works?|matches?|looks? good) with (?:my )?(?:an? )?(\w+(?:\s+\w+)?)/i,
      /what (?:to wear|should i wear|can i wear) with (?:my )?(?:an? )?(\w+(?:\s+\w+)?)/i,
      /(?:recommend|suggest|find)(?: me)? (?:something|items?|clothes?|a top|tops?) (?:to go|that goes?|to pair|that pairs?) with (?:my )?(?:an? )?(\w+(?:\s+\w+)?)/i,
      /(?:i have|i own|i.ve got)(?: an?)? (\w+(?:\s+\w+)?)\s*(?:skirt|dress|pants|top).*(?:what|recommend|suggest)/i,
      /top(?:s)? for (?:my )?(?:an? )?(\w+(?:\s+\w+)?)\s*(?:skirt|dress|pants|bottom)/i,
    ];

    for (const pattern of pairingPatterns) {
      const match = messageLower.match(pattern);
      if (match) {
        const potentialColor = match[1]?.trim();
        if (potentialColor && this.isValidColor(potentialColor)) {
          // Extract item type if present
          const itemTypeMatch = messageLower.match(/(skirt|dress|pants|top|shirt|jacket|coat|sweater|blazer|cardigan|jeans|shorts)/);
          return {
            isPairingQuery: true,
            existingColor: potentialColor,
            itemType: itemTypeMatch?.[1],
          };
        }
      }
    }

    return { isPairingQuery: false };
  }

  /**
   * Transform search terms for color pairing queries
   * Instead of searching for "olive top", search for complementary colors
   */
  transformSearchTermsForPairing(
    originalTerms: string,
    existingColor: string,
    itemType?: string,
  ): { terms: string; colors: string[] } {
    const pairings = this.getColorPairings({ existingColor, itemType });

    // Build search terms WITHOUT the original color
    // Instead, use complementary colors
    const searchColors = pairings.complementaryColors.slice(0, 3);
    const neutrals = pairings.neutralColors.slice(0, 2);

    // Determine what item type to search for
    const targetItem = itemType ? this.getComplementaryItemType(itemType) : 'top';

    // Build terms prioritizing complementary colors
    const allColors = [...searchColors, ...neutrals];

    this.logger.log(
      `Transformed color pairing search: "${existingColor} ${itemType}" -> "${targetItem}" in colors [${allColors.join(', ')}]`,
    );

    return {
      terms: targetItem,
      colors: allColors,
    };
  }

  /**
   * Get complementary item type (if user has a bottom, suggest tops, etc.)
   */
  private getComplementaryItemType(existingItemType: string): string {
    const itemTypeLower = existingItemType.toLowerCase();

    // Bottoms need tops
    if (['skirt', 'pants', 'jeans', 'shorts', 'trousers'].includes(itemTypeLower)) {
      return 'top';
    }

    // Tops need bottoms
    if (['top', 'shirt', 'blouse', 'sweater', 'cardigan', 't-shirt', 'tank'].includes(itemTypeLower)) {
      return 'pants OR skirt';
    }

    // Dresses/outerwear need accessories
    if (['dress', 'jacket', 'coat', 'blazer'].includes(itemTypeLower)) {
      return 'accessories OR shoes';
    }

    return 'clothing';
  }

  /**
   * Normalize color name to a standard form
   */
  private normalizeColorName(color: string): string {
    const colorLower = color.toLowerCase().trim();

    // Direct match
    if (COLOR_MAP[colorLower]) {
      return colorLower;
    }

    // Check for color variations
    const colorVariations: Record<string, string> = {
      'olive green': 'olive',
      'navy blue': 'navy',
      'forest green': 'green',
      'hunter green': 'green',
      'kelly green': 'green',
      'sage green': 'sage',
      'mint green': 'mint',
      'sky blue': 'blue',
      'baby blue': 'blue',
      'royal blue': 'blue',
      'cobalt blue': 'blue',
      'powder blue': 'blue',
      'dusty pink': 'pink',
      'dusty rose': 'pink',
      'hot pink': 'pink',
      'blush pink': 'blush',
      'wine red': 'burgundy',
      'brick red': 'rust',
      'burnt orange': 'rust',
      'mustard yellow': 'yellow',
      'lemon yellow': 'yellow',
      'charcoal gray': 'charcoal',
      'charcoal grey': 'charcoal',
      'light gray': 'gray',
      'light grey': 'gray',
      'dark gray': 'charcoal',
      'dark grey': 'charcoal',
    };

    if (colorVariations[colorLower]) {
      return colorVariations[colorLower];
    }

    // Check if the color contains a known base color
    for (const baseColor of Object.keys(FASHION_COLOR_PAIRINGS)) {
      if (colorLower.includes(baseColor)) {
        return baseColor;
      }
    }

    // Default to the original (might be a hex code or unknown color)
    return colorLower;
  }

  /**
   * Check if a string is a valid color name
   */
  private isValidColor(color: string): boolean {
    const colorLower = color.toLowerCase().trim();

    // Check direct match
    if (COLOR_MAP[colorLower]) return true;

    // Check if it contains any known color
    for (const knownColor of Object.keys(COLOR_MAP)) {
      if (colorLower.includes(knownColor)) return true;
    }

    // Check hex format
    if (/^#[0-9A-Fa-f]{6}$/.test(color)) return true;

    return false;
  }

  /**
   * Generate color pairings using color theory when predefined pairings don't exist
   */
  private generateColorTheoryPairings(color: string): { complementary: string[]; neutrals: string[]; accents: string[]; avoid: string[]; tips: string[] } {
    // Default safe pairings for unknown colors
    return {
      complementary: ['white', 'cream', 'black', 'navy', 'gray'],
      neutrals: ['white', 'black', 'gray', 'beige', 'cream'],
      accents: ['gold', 'silver'],
      avoid: [],
      tips: [
        'When in doubt, pair with neutrals like white, black, or gray',
        'Cream and beige are safe, sophisticated options',
        'Metallic accessories (gold or silver) add polish to any color',
      ],
    };
  }

  /**
   * Adjust recommendations based on occasion and style context
   */
  private adjustForContext(
    pairings: { complementary: string[]; neutrals: string[]; accents: string[]; avoid: string[]; tips: string[] },
    query: ColorPairingQuery,
  ): { complementary: string[]; neutrals: string[]; accents: string[]; avoid: string[]; tips: string[] } {
    const result = { ...pairings };

    // Adjust for occasion
    if (query.occasion) {
      const occasionLower = query.occasion.toLowerCase();

      if (['formal', 'business', 'work', 'professional'].includes(occasionLower)) {
        // Prioritize neutrals and classic colors for formal occasions
        result.complementary = [...result.neutrals, ...result.complementary.filter(c =>
          ['navy', 'burgundy', 'cream', 'white', 'gray', 'charcoal'].includes(c)
        )];
        result.tips.push('For formal occasions, stick to classic neutrals and sophisticated tones');
      }

      if (['casual', 'weekend', 'brunch', 'date'].includes(occasionLower)) {
        // Keep all colors, emphasize versatility
        result.tips.push('For casual settings, feel free to experiment with bolder color combinations');
      }
    }

    // Adjust for style preference
    if (query.style) {
      const styleLower = query.style.toLowerCase();

      if (styleLower === 'minimalist') {
        result.complementary = result.complementary.filter(c =>
          ['white', 'black', 'gray', 'cream', 'beige', 'navy', 'camel'].includes(c)
        );
        result.tips.push('Minimalist style pairs best with clean neutrals and monochromatic looks');
      }

      if (styleLower === 'bold' || styleLower === 'maximalist') {
        result.complementary = [
          ...result.accents,
          ...result.complementary.filter(c => !['white', 'black', 'gray', 'beige'].includes(c)),
        ];
        result.tips.push('For bold style, embrace contrasting and unexpected color combinations');
      }
    }

    return result;
  }

  /**
   * Determine the color scheme type
   */
  private determineColorScheme(
    baseColor: string,
    complementaryColors: string[],
  ): 'complementary' | 'analogous' | 'triadic' | 'neutral' | 'monochromatic' {
    // Check if mostly neutrals
    const neutralSet = new Set(['white', 'black', 'gray', 'beige', 'cream', 'tan', 'charcoal']);
    const neutralCount = complementaryColors.filter(c => neutralSet.has(c)).length;

    if (neutralCount > complementaryColors.length / 2) {
      return 'neutral';
    }

    // For now, default to complementary (most fashion-forward)
    return 'complementary';
  }
}
