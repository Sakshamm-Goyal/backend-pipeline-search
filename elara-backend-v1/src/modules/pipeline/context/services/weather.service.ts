import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  WeatherContext,
  WeatherCondition,
  WeatherApiResponse,
} from '../dto/context-pack.dto';

/**
 * Weather Service
 *
 * ENHANCED: Fetches weather data from OpenWeatherMap API with optional mock mode.
 * Transforms weather data into a format suitable for fashion recommendations.
 *
 * Mode Toggle (per user requirement):
 * - If OPENWEATHER_API_KEY is configured: Uses real OpenWeatherMap API
 * - If not configured: Uses realistic mock data based on location and season
 */
@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.openweathermap.org/data/2.5';
  private readonly useRealApi: boolean;

  // Cache weather data for 30 minutes
  private cache = new Map<string, { data: WeatherContext; timestamp: number }>();
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes

  // Seasonal weather patterns by region for mock data (base data without location/timestamp)
  private readonly seasonalPatterns: Record<string, Record<string, Omit<WeatherContext, 'location' | 'timestamp'>>> = {
    // Northern Hemisphere patterns
    north: {
      winter: { temperature: 35, feelsLike: 30, condition: 'cold', humidity: 65, windSpeed: 15, precipitation: 0.2, uvIndex: 2 },
      spring: { temperature: 58, feelsLike: 55, condition: 'partly_cloudy', humidity: 55, windSpeed: 10, precipitation: 0.1, uvIndex: 4 },
      summer: { temperature: 82, feelsLike: 85, condition: 'sunny', humidity: 60, windSpeed: 8, precipitation: 0, uvIndex: 8 },
      fall: { temperature: 52, feelsLike: 48, condition: 'cloudy', humidity: 60, windSpeed: 12, precipitation: 0.15, uvIndex: 3 },
    },
    // Southern Hemisphere patterns (reversed seasons)
    south: {
      winter: { temperature: 78, feelsLike: 80, condition: 'sunny', humidity: 55, windSpeed: 8, precipitation: 0, uvIndex: 7 },
      spring: { temperature: 55, feelsLike: 52, condition: 'partly_cloudy', humidity: 58, windSpeed: 10, precipitation: 0.1, uvIndex: 4 },
      summer: { temperature: 38, feelsLike: 35, condition: 'cold', humidity: 68, windSpeed: 14, precipitation: 0.2, uvIndex: 2 },
      fall: { temperature: 62, feelsLike: 60, condition: 'partly_cloudy', humidity: 52, windSpeed: 9, precipitation: 0.05, uvIndex: 5 },
    },
  };

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    this.apiKey = this.configService.get<string>('OPENWEATHER_API_KEY') || '';

    // Determine mode based on API key availability
    this.useRealApi = !!this.apiKey;

    if (this.useRealApi) {
      this.logger.log('Weather service initialized in REAL API mode (OpenWeatherMap)');
    } else {
      this.logger.log('Weather service initialized in MOCK mode (no API key configured)');
    }
  }

  /**
   * Get weather for a location
   * ENHANCED: Uses mock data based on location and season when API key is not configured
   */
  async getWeather(location?: string): Promise<WeatherContext | undefined> {
    if (!location) {
      return undefined;
    }

    // Check cache first
    const cacheKey = location.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      this.logger.debug(`Weather cache hit for ${location}`);
      return cached.data;
    }

    // MOCK MODE: Generate realistic weather based on location and season
    if (!this.useRealApi) {
      const mockWeather = this.generateMockWeather(location);
      this.cache.set(cacheKey, { data: mockWeather, timestamp: Date.now() });
      this.logger.log(`Mock weather generated for ${location}: ${mockWeather.temperature}°F, ${mockWeather.condition}`);
      return mockWeather;
    }

    // REAL API MODE: Fetch from OpenWeatherMap
    try {
      // Get coordinates from location name
      const coords = await this.geocode(location);
      if (!coords) {
        this.logger.warn(`Could not geocode location: ${location}`);
        return this.getDefaultWeather(location);
      }

      // Fetch weather data
      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/weather`, {
          params: {
            lat: coords.lat,
            lon: coords.lon,
            appid: this.apiKey,
            units: 'imperial', // Fahrenheit
          },
        }),
      );

      const weather = this.transformWeatherResponse(response.data as WeatherApiResponse, location);

      // Cache the result
      this.cache.set(cacheKey, { data: weather, timestamp: Date.now() });

      this.logger.log(`Weather fetched for ${location}: ${weather.temperature}°F, ${weather.condition}`);

      return weather;
    } catch (error) {
      this.logger.error(`Failed to fetch weather for ${location}: ${(error as Error).message}`);
      return this.getDefaultWeather(location);
    }
  }

  /**
   * Generate realistic mock weather based on location and current season
   */
  private generateMockWeather(location: string): WeatherContext {
    // Determine hemisphere based on location hints
    const hemisphere = this.determineHemisphere(location);

    // Determine current season
    const season = this.getCurrentSeason(hemisphere);

    // Get seasonal pattern
    const baseWeather = this.seasonalPatterns[hemisphere][season];

    // Add some randomness to make it more realistic
    const tempVariation = (Math.random() - 0.5) * 10; // ±5°F
    const humidityVariation = (Math.random() - 0.5) * 20; // ±10%

    const weather: WeatherContext = {
      temperature: Math.round(baseWeather.temperature + tempVariation),
      feelsLike: Math.round(baseWeather.feelsLike + tempVariation),
      condition: baseWeather.condition,
      humidity: Math.max(20, Math.min(90, Math.round(baseWeather.humidity + humidityVariation))),
      windSpeed: baseWeather.windSpeed,
      precipitation: baseWeather.precipitation,
      uvIndex: baseWeather.uvIndex,
      location,
      timestamp: new Date(),
    };

    return weather;
  }

  /**
   * Determine hemisphere based on location name
   */
  private determineHemisphere(location: string): 'north' | 'south' {
    const locationLower = location.toLowerCase();

    // Southern hemisphere cities/countries
    const southernLocations = [
      'australia', 'sydney', 'melbourne', 'brisbane',
      'new zealand', 'auckland', 'wellington',
      'south africa', 'cape town', 'johannesburg',
      'argentina', 'buenos aires',
      'brazil', 'sao paulo', 'rio',
      'chile', 'santiago',
      'peru', 'lima',
    ];

    for (const loc of southernLocations) {
      if (locationLower.includes(loc)) {
        return 'south';
      }
    }

    return 'north'; // Default to northern hemisphere
  }

  /**
   * Get current season based on hemisphere
   */
  private getCurrentSeason(hemisphere: 'north' | 'south'): string {
    const month = new Date().getMonth(); // 0-11

    // Northern hemisphere seasons
    const northernSeasons: Record<number, string> = {
      0: 'winter', 1: 'winter', 2: 'spring',
      3: 'spring', 4: 'spring', 5: 'summer',
      6: 'summer', 7: 'summer', 8: 'fall',
      9: 'fall', 10: 'fall', 11: 'winter',
    };

    // Southern hemisphere has reversed seasons
    const southernSeasons: Record<number, string> = {
      0: 'summer', 1: 'summer', 2: 'fall',
      3: 'fall', 4: 'fall', 5: 'winter',
      6: 'winter', 7: 'winter', 8: 'spring',
      9: 'spring', 10: 'spring', 11: 'summer',
    };

    return hemisphere === 'north' ? northernSeasons[month] : southernSeasons[month];
  }

  /**
   * Geocode a location name to coordinates
   */
  private async geocode(location: string): Promise<{ lat: number; lon: number } | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<Array<{ lat: number; lon: number; name: string }>>('https://api.openweathermap.org/geo/1.0/direct', {
          params: {
            q: location,
            limit: 1,
            appid: this.apiKey,
          },
        }),
      );

      const data = response.data;
      if (data && data.length > 0) {
        return {
          lat: data[0].lat,
          lon: data[0].lon,
        };
      }

      return null;
    } catch (error) {
      this.logger.error(`Geocoding failed for ${location}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Transform API response to WeatherContext
   */
  private transformWeatherResponse(data: WeatherApiResponse, location: string): WeatherContext {
    const mainCondition = data.weather[0]?.main.toLowerCase() || '';
    const temp = data.main.temp;

    return {
      temperature: Math.round(temp),
      feelsLike: Math.round(data.main.feels_like),
      condition: this.mapCondition(mainCondition, temp),
      humidity: data.main.humidity,
      windSpeed: Math.round(data.wind.speed),
      precipitation: data.rain?.['1h'] || 0,
      uvIndex: data.uvi || 0,
      location,
      timestamp: new Date(),
    };
  }

  /**
   * Map weather API condition to our WeatherCondition type
   */
  private mapCondition(apiCondition: string, temperature: number): WeatherCondition {
    // Temperature-based conditions take precedence
    if (temperature >= 90) return 'hot';
    if (temperature <= 32) return 'cold';

    // Weather condition mapping
    const conditionMap: Record<string, WeatherCondition> = {
      clear: 'sunny',
      sunny: 'sunny',
      clouds: 'cloudy',
      overcast: 'cloudy',
      'few clouds': 'partly_cloudy',
      'scattered clouds': 'partly_cloudy',
      'broken clouds': 'partly_cloudy',
      rain: 'rainy',
      drizzle: 'rainy',
      shower: 'rainy',
      thunderstorm: 'stormy',
      snow: 'snowy',
      sleet: 'snowy',
      mist: 'foggy',
      fog: 'foggy',
      haze: 'foggy',
      smoke: 'foggy',
      dust: 'windy',
      sand: 'windy',
      squall: 'windy',
      tornado: 'stormy',
    };

    return conditionMap[apiCondition] || 'partly_cloudy';
  }

  /**
   * Get default weather when API is unavailable
   */
  private getDefaultWeather(location: string): WeatherContext {
    // Return mild, pleasant weather as default
    return {
      temperature: 68,
      feelsLike: 68,
      condition: 'partly_cloudy',
      humidity: 50,
      windSpeed: 5,
      precipitation: 0,
      uvIndex: 3,
      location,
      timestamp: new Date(),
    };
  }

  /**
   * Get weather-appropriate greeting
   */
  getWeatherGreeting(weather: WeatherContext): string {
    if (weather.temperature >= 85) {
      return "It's a hot one out there!";
    }
    if (weather.temperature <= 40) {
      return "Bundle up, it's chilly!";
    }
    if (weather.condition === 'rainy') {
      return "Don't forget your umbrella!";
    }
    if (weather.condition === 'sunny') {
      return "Perfect day for an outfit!";
    }
    return "Great weather for fashion!";
  }

  /**
   * Determine if weather data should affect recommendations
   */
  isWeatherSignificant(weather: WeatherContext): boolean {
    return (
      weather.temperature < 50 || // Cold
      weather.temperature > 80 || // Hot
      weather.condition === 'rainy' ||
      weather.condition === 'snowy' ||
      weather.condition === 'stormy' ||
      weather.precipitation > 0.1
    );
  }
}
