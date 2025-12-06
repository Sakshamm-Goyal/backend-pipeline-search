/**
 * Context Pack DTOs
 *
 * Comprehensive context object that aggregates all relevant information
 * for outfit generation and product recommendations.
 */

export interface ContextPack {
  userProfile: UserProfileContext;
  wardrobe: WardrobeItem[];
  weather?: WeatherContext;
  constraints: StyleConstraints;
  eventContext?: EventContext;
  trends: FashionTrend[];
  filters: ContextFilters;
  timestamp: Date;
}

export interface UserProfileContext {
  userId: string;
  gender: 'male' | 'female' | 'unisex';
  stylePreferences: {
    primaryStyle: string;
    selectedStyles: string[];
    colorPreferences: string[];
    avoidColors: string[];
    modestDressing?: boolean;
  };
  brandPreferences: {
    likedBrands: string[];
    dislikedBrands: string[];
    priceRange: {
      min: number;
      max: number;
    };
  };
  bodyProfile?: {
    height?: number;
    weight?: number;
    bodyType?: string;
  } | any;
  location?: {
    city?: string;
    country?: string;
    timezone?: string;
  };
}

export interface WardrobeItem {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  color: string;
  brand?: string;
  imageUrl?: string;
  tags?: string[];
  wearCount?: number;
  lastWorn?: Date;
  seasonality?: string[];
}

export interface WeatherContext {
  temperature: number; // Fahrenheit
  feelsLike: number;
  condition: WeatherCondition;
  humidity: number;
  windSpeed: number;
  precipitation: number;
  uvIndex: number;
  location: string;
  timestamp: Date;
}

export type WeatherCondition =
  | 'sunny'
  | 'cloudy'
  | 'partly_cloudy'
  | 'rainy'
  | 'stormy'
  | 'snowy'
  | 'windy'
  | 'foggy'
  | 'hot'
  | 'cold';

export interface StyleConstraints {
  // Weather-based constraints
  temperatureRange: 'cold' | 'cool' | 'mild' | 'warm' | 'hot';
  needsOuterwear: boolean;
  needsRainProtection: boolean;
  needsSunProtection: boolean;

  // Material constraints
  preferredMaterials: string[];
  avoidMaterials: string[];

  // Coverage constraints
  minCoverage: 'minimal' | 'moderate' | 'full';

  // Layering suggestions
  suggestLayering: boolean;
  layerCount: number;

  // Color constraints (seasonal)
  seasonalColors: string[];
}

export interface EventContext {
  occasion: string;
  formality: 'casual' | 'smart_casual' | 'business_casual' | 'business' | 'formal' | 'black_tie';
  settingType: 'indoor' | 'outdoor' | 'mixed';
  duration?: number; // hours
  activityLevel: 'low' | 'moderate' | 'high';
  socialContext?: 'professional' | 'social' | 'romantic' | 'family';
  dressCode?: string;
  culturalConsiderations?: string[];
}

export interface FashionTrend {
  name: string;
  category: 'color' | 'silhouette' | 'pattern' | 'material' | 'style';
  season: string;
  relevanceScore: number; // 0-1
  description?: string;
}

export interface ContextFilters {
  occasion?: string;
  itemType?: string;
  color?: string[];
  style?: string;
  priceRange?: {
    min?: number;
    max?: number;
  };
  brands?: string[];
  excludeBrands?: string[];
  location?: string;
  datetime?: Date;
}

/**
 * Weather API response mapping
 */
export interface WeatherApiResponse {
  main: {
    temp: number;
    feels_like: number;
    humidity: number;
  };
  weather: Array<{
    main: string;
    description: string;
  }>;
  wind: {
    speed: number;
  };
  rain?: {
    '1h'?: number;
  };
  uvi?: number;
}

/**
 * Temperature ranges for constraint derivation
 */
export const TEMPERATURE_RANGES = {
  cold: { max: 40 }, // Below 40°F
  cool: { min: 40, max: 55 }, // 40-55°F
  mild: { min: 55, max: 70 }, // 55-70°F
  warm: { min: 70, max: 85 }, // 70-85°F
  hot: { min: 85 }, // Above 85°F
};

/**
 * Material recommendations by temperature
 */
export const MATERIAL_BY_TEMPERATURE: Record<string, { preferred: string[]; avoid: string[] }> = {
  cold: {
    preferred: ['wool', 'cashmere', 'fleece', 'down', 'leather'],
    avoid: ['linen', 'silk', 'mesh'],
  },
  cool: {
    preferred: ['cotton', 'wool blend', 'denim', 'flannel'],
    avoid: ['mesh', 'sheer'],
  },
  mild: {
    preferred: ['cotton', 'jersey', 'light wool', 'denim'],
    avoid: [],
  },
  warm: {
    preferred: ['cotton', 'linen', 'chambray', 'rayon'],
    avoid: ['wool', 'fleece', 'leather'],
  },
  hot: {
    preferred: ['linen', 'cotton', 'chambray', 'moisture-wicking'],
    avoid: ['wool', 'fleece', 'leather', 'polyester'],
  },
};

/**
 * Formality level mappings for occasions
 */
export const OCCASION_FORMALITY: Record<string, string> = {
  // Casual
  casual: 'casual',
  brunch: 'casual',
  shopping: 'casual',
  running_errands: 'casual',
  beach: 'casual',
  picnic: 'casual',

  // Smart Casual
  dinner: 'smart_casual',
  date_night: 'smart_casual',
  concert: 'smart_casual',
  birthday_party: 'smart_casual',
  drinks: 'smart_casual',

  // Business Casual
  work: 'business_casual',
  office: 'business_casual',
  meeting: 'business_casual',
  conference: 'business_casual',
  networking: 'business_casual',

  // Business
  interview: 'business',
  presentation: 'business',
  client_meeting: 'business',

  // Formal
  wedding: 'formal',
  gala: 'formal',
  graduation: 'formal',
  cocktail_party: 'formal',

  // Black Tie
  black_tie: 'black_tie',
  red_carpet: 'black_tie',
  opera: 'black_tie',
};

/**
 * 2025 Fashion Trends
 */
export const FASHION_TRENDS_2025: FashionTrend[] = [
  // Colors
  { name: 'Mocha Mousse', category: 'color', season: '2025', relevanceScore: 0.95, description: 'Pantone Color of the Year 2025' },
  { name: 'Espresso Brown', category: 'color', season: '2025', relevanceScore: 0.9 },
  { name: 'Butter Yellow', category: 'color', season: 'Spring 2025', relevanceScore: 0.85 },
  { name: 'Cherry Red', category: 'color', season: '2025', relevanceScore: 0.88 },
  { name: 'Burgundy', category: 'color', season: 'Fall 2025', relevanceScore: 0.87 },

  // Silhouettes
  { name: 'Relaxed Fit', category: 'silhouette', season: '2025', relevanceScore: 0.9 },
  { name: 'Wide-Leg Pants', category: 'silhouette', season: '2025', relevanceScore: 0.88 },
  { name: 'Oversized Blazers', category: 'silhouette', season: '2025', relevanceScore: 0.85 },
  { name: 'Midi Length', category: 'silhouette', season: '2025', relevanceScore: 0.82 },

  // Patterns
  { name: 'Animal Print', category: 'pattern', season: '2025', relevanceScore: 0.78 },
  { name: 'Bold Stripes', category: 'pattern', season: '2025', relevanceScore: 0.75 },
  { name: 'Florals', category: 'pattern', season: 'Spring 2025', relevanceScore: 0.8 },

  // Materials
  { name: 'Leather', category: 'material', season: '2025', relevanceScore: 0.85 },
  { name: 'Sheer Fabrics', category: 'material', season: '2025', relevanceScore: 0.7 },
  { name: 'Sustainable Fabrics', category: 'material', season: '2025', relevanceScore: 0.9 },

  // Styles
  { name: 'Quiet Luxury', category: 'style', season: '2025', relevanceScore: 0.92 },
  { name: 'Boho Revival', category: 'style', season: '2025', relevanceScore: 0.78 },
  { name: 'Minimalist Chic', category: 'style', season: '2025', relevanceScore: 0.88 },
];
