import { Injectable, Logger } from '@nestjs/common';
import {
  WeatherContext,
  StyleConstraints,
  EventContext,
  TEMPERATURE_RANGES,
  MATERIAL_BY_TEMPERATURE,
} from '../dto/context-pack.dto';

/**
 * Constraint Derivation Service
 *
 * Derives style constraints from weather and event context.
 * This is a deterministic layer that produces rules for outfit generation.
 */
@Injectable()
export class ConstraintDerivationService {
  private readonly logger = new Logger(ConstraintDerivationService.name);

  /**
   * Derive style constraints from weather and event context
   */
  derive(weather?: WeatherContext, event?: EventContext): StyleConstraints {
    // Start with defaults
    let constraints: StyleConstraints = {
      temperatureRange: 'mild',
      needsOuterwear: false,
      needsRainProtection: false,
      needsSunProtection: false,
      preferredMaterials: ['cotton', 'jersey', 'denim'],
      avoidMaterials: [],
      minCoverage: 'moderate',
      suggestLayering: false,
      layerCount: 1,
      seasonalColors: this.getSeasonalColors(),
    };

    // Apply weather constraints
    if (weather) {
      constraints = this.applyWeatherConstraints(constraints, weather);
    }

    // Apply event constraints
    if (event) {
      constraints = this.applyEventConstraints(constraints, event);
    }

    this.logger.debug(`Derived constraints: ${JSON.stringify(constraints)}`);

    return constraints;
  }

  /**
   * Apply weather-based constraints
   */
  private applyWeatherConstraints(
    constraints: StyleConstraints,
    weather: WeatherContext,
  ): StyleConstraints {
    const temp = weather.temperature;

    // Determine temperature range
    if (temp < TEMPERATURE_RANGES.cold.max) {
      constraints.temperatureRange = 'cold';
    } else if (temp >= TEMPERATURE_RANGES.cool.min && temp < TEMPERATURE_RANGES.cool.max) {
      constraints.temperatureRange = 'cool';
    } else if (temp >= TEMPERATURE_RANGES.mild.min && temp < TEMPERATURE_RANGES.mild.max) {
      constraints.temperatureRange = 'mild';
    } else if (temp >= TEMPERATURE_RANGES.warm.min && temp < TEMPERATURE_RANGES.warm.max) {
      constraints.temperatureRange = 'warm';
    } else {
      constraints.temperatureRange = 'hot';
    }

    // Apply material constraints based on temperature
    const materialRules = MATERIAL_BY_TEMPERATURE[constraints.temperatureRange];
    if (materialRules) {
      constraints.preferredMaterials = materialRules.preferred;
      constraints.avoidMaterials = materialRules.avoid;
    }

    // Outerwear needs
    if (temp < 60 || weather.condition === 'windy') {
      constraints.needsOuterwear = true;
    }

    // Rain protection
    if (weather.condition === 'rainy' || weather.condition === 'stormy' || weather.precipitation > 0.1) {
      constraints.needsRainProtection = true;
      constraints.avoidMaterials.push('suede', 'silk');
    }

    // Sun protection
    if (weather.condition === 'sunny' && weather.uvIndex > 5) {
      constraints.needsSunProtection = true;
    }

    // Coverage based on temperature
    if (constraints.temperatureRange === 'cold') {
      constraints.minCoverage = 'full';
    } else if (constraints.temperatureRange === 'hot') {
      constraints.minCoverage = 'minimal';
    }

    // Layering suggestions
    constraints.suggestLayering = this.shouldSuggestLayering(weather);
    constraints.layerCount = this.calculateLayerCount(weather);

    return constraints;
  }

  /**
   * Apply event-based constraints
   */
  private applyEventConstraints(
    constraints: StyleConstraints,
    event: EventContext,
  ): StyleConstraints {
    // Formality affects material preferences
    switch (event.formality) {
      case 'black_tie':
      case 'formal':
        constraints.preferredMaterials = [
          ...constraints.preferredMaterials,
          'silk', 'satin', 'velvet', 'wool crepe',
        ];
        constraints.minCoverage = 'full';
        break;

      case 'business':
      case 'business_casual':
        constraints.preferredMaterials = [
          ...constraints.preferredMaterials,
          'wool', 'cotton blend', 'silk blend',
        ];
        break;

      case 'casual':
        constraints.preferredMaterials = [
          ...constraints.preferredMaterials,
          'denim', 'jersey', 't-shirt cotton',
        ];
        break;
    }

    // Activity level affects material choice
    if (event.activityLevel === 'high') {
      constraints.preferredMaterials.push('stretch', 'performance fabric');
      constraints.avoidMaterials.push('restrictive', 'dry-clean only');
    }

    // Outdoor events need practical materials
    if (event.settingType === 'outdoor') {
      constraints.avoidMaterials.push('pure silk', 'delicate fabrics');
      if (!constraints.needsOuterwear) {
        constraints.suggestLayering = true;
        constraints.layerCount = Math.max(constraints.layerCount, 2);
      }
    }

    // Modest dressing consideration
    if (event.culturalConsiderations?.some(c => c.includes('modest'))) {
      constraints.minCoverage = 'full';
    }

    return constraints;
  }

  /**
   * Determine if layering should be suggested
   */
  private shouldSuggestLayering(weather: WeatherContext): boolean {
    // Large temperature variance throughout day
    const tempDelta = Math.abs(weather.temperature - weather.feelsLike);

    // Variable conditions
    const variableConditions = [
      'partly_cloudy',
      'windy',
    ];

    return (
      tempDelta > 10 ||
      variableConditions.includes(weather.condition) ||
      (weather.temperature >= 50 && weather.temperature <= 70) // Transitional temps
    );
  }

  /**
   * Calculate recommended layer count
   */
  private calculateLayerCount(weather: WeatherContext): number {
    const temp = weather.temperature;

    if (temp < 32) return 4; // Very cold: base + mid + outer + accessories
    if (temp < 45) return 3; // Cold: base + mid + outer
    if (temp < 60) return 2; // Cool: base + outer
    if (temp < 75) return 2; // Mild: optional layering
    return 1; // Warm/Hot: single layer
  }

  /**
   * Get seasonal colors based on current date
   */
  private getSeasonalColors(): string[] {
    const month = new Date().getMonth();

    // Winter (Dec-Feb)
    if (month === 11 || month <= 1) {
      return [
        'deep burgundy', 'forest green', 'navy', 'charcoal',
        'ivory', 'camel', 'chocolate brown',
      ];
    }

    // Spring (Mar-May)
    if (month >= 2 && month <= 4) {
      return [
        'pastel pink', 'lavender', 'mint green', 'butter yellow',
        'sky blue', 'coral', 'blush',
      ];
    }

    // Summer (Jun-Aug)
    if (month >= 5 && month <= 7) {
      return [
        'white', 'bright coral', 'turquoise', 'lemon yellow',
        'hot pink', 'cobalt blue', 'tangerine',
      ];
    }

    // Fall (Sep-Nov)
    return [
      'rust', 'mustard', 'olive', 'burgundy',
      'burnt orange', 'chocolate', 'camel',
    ];
  }

  /**
   * Get footwear recommendations based on constraints
   */
  getFootwearRecommendations(constraints: StyleConstraints): string[] {
    const recommendations: string[] = [];

    if (constraints.needsRainProtection) {
      recommendations.push('waterproof boots', 'rain boots', 'water-resistant sneakers');
    }

    if (constraints.temperatureRange === 'cold') {
      recommendations.push('insulated boots', 'ankle boots', 'closed-toe shoes');
    } else if (constraints.temperatureRange === 'hot') {
      recommendations.push('sandals', 'breathable sneakers', 'loafers');
    }

    if (constraints.minCoverage === 'full') {
      recommendations.push('closed-toe shoes', 'boots', 'oxford shoes');
    }

    return recommendations;
  }

  /**
   * Get outerwear recommendations based on constraints
   */
  getOuterwearRecommendations(constraints: StyleConstraints): string[] {
    const recommendations: string[] = [];

    if (constraints.needsRainProtection) {
      recommendations.push('trench coat', 'rain jacket', 'windbreaker');
    }

    switch (constraints.temperatureRange) {
      case 'cold':
        recommendations.push('wool coat', 'puffer jacket', 'down coat');
        break;
      case 'cool':
        recommendations.push('leather jacket', 'denim jacket', 'light wool coat');
        break;
      case 'mild':
        recommendations.push('blazer', 'cardigan', 'light jacket');
        break;
      case 'warm':
        recommendations.push('light cardigan', 'linen blazer');
        break;
    }

    return recommendations;
  }
}
