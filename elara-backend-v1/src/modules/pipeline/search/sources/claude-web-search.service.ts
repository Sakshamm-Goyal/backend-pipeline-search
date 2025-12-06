import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import {
  BaseSearchSource,
  ISearchSource,
} from './search-source.interface';
import { Product, SearchSource, normalizeProduct } from '../dto/product.dto';
import type { SearchQuery } from '../dto/search-query.dto';
import { Retry } from '../../infrastructure/resilience/retry.decorator';

/**
 * Claude Web Search Service
 *
 * Uses Claude's web search capability to find fashion products.
 * Claude can understand complex queries and return structured product data.
 *
 * This is particularly useful for:
 * - Complex style descriptions ("boho summer wedding guest dress")
 * - Celebrity/influencer style lookups
 * - Trend-based searches
 * - Finding specific items from descriptions
 *
 * Note: Requires Claude API with tool use enabled
 */
@Injectable()
export class ClaudeWebSearchService extends BaseSearchSource implements ISearchSource {
  readonly name = SearchSource.CLAUDE_WEB;
  readonly priority = 60; // Lower priority (expensive, use as fallback)
  readonly timeout = 45000; // 45s timeout (LLM + web search)

  protected readonly logger = new Logger(ClaudeWebSearchService.name);

  private client!: Anthropic;
  private apiKey!: string;

  constructor(private config: ConfigService) {
    super();

    this.apiKey = this.config.get<string>('ANTHROPIC_API_KEY')!;

    if (!this.apiKey) {
      this.logger.warn('Anthropic API key not configured. Claude Web Search will be disabled.');
      return;
    }

    this.client = new Anthropic({ apiKey: this.apiKey });

    this.logger.log('Claude Web Search service initialized');
  }

  get enabled(): boolean {
    // DISABLED BY DEFAULT: This service generates fabricated/hallucinated product URLs
    // Claude doesn't actually browse the web - it generates fictional product data
    // that looks real but has fake URLs, prices, and product IDs.
    //
    // To enable (NOT RECOMMENDED), set ENABLE_CLAUDE_WEB_SEARCH=true in .env
    // If enabled, products from this source will be filtered out by ProductRankerService
    // in the filterByUrlType() method anyway.
    const explicitlyEnabled = this.config.get<string>('ENABLE_CLAUDE_WEB_SEARCH') === 'true';

    if (!explicitlyEnabled && this.apiKey) {
      this.logger.warn(
        'Claude Web Search is DISABLED by default because it generates fabricated URLs. ' +
        'Products from this source have fake links that do not lead to real products.'
      );
    }

    return explicitlyEnabled && !!this.apiKey;
  }

  /**
   * Search for fashion products using Claude's web search
   */
  @Retry({
    maxRetries: 2,
    backoff: 'exponential',
    retryOn: [429, 500, 502, 503, 504],
  })
  async search(query: SearchQuery): Promise<Product[]> {
    const startTime = Date.now();

    try {
      const limit = Math.min(query.limit || 10, 10); // Limit to 10 for cost

      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: this.buildSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: this.buildSearchPrompt(query, limit),
          },
        ],
      });

      // Parse the response
      const firstContent = response.content[0];
      const text = 'text' in firstContent ? firstContent.text : '';
      const products = this.parseResponse(text, query);

      const latency = Date.now() - startTime;
      this.trackSuccess(latency);

      this.logger.log(`Claude Web Search returned ${products.length} products in ${latency}ms`);

      return products;
    } catch (error) {
      this.trackFailure(error as Error);
      this.logger.error(`Claude Web Search failed: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Build system prompt for fashion product search
   */
  private buildSystemPrompt(): string {
    return `You are a fashion product search assistant. Your task is to find real, currently available fashion products based on user queries.

IMPORTANT: You must return REAL products that can actually be purchased. Include:
- Actual product names
- Real retailer names (Amazon, Nordstrom, ASOS, Zara, etc.)
- Realistic prices
- Valid product URLs when possible

Format your response as a JSON array of products with this structure:
{
  "products": [
    {
      "title": "Product Name",
      "brand": "Brand Name",
      "retailer": "Store Name",
      "price": 79.99,
      "originalPrice": 99.99,
      "onSale": true,
      "productUrl": "https://...",
      "imageUrl": "https://...",
      "color": "Navy Blue",
      "category": "dress|top|bottom|shoes|outerwear|accessories",
      "description": "Brief product description",
      "inStock": true
    }
  ]
}

Only include products that match the search criteria. Be specific and accurate.`;
  }

  /**
   * Build search prompt
   */
  private buildSearchPrompt(query: SearchQuery, limit: number): string {
    let prompt = `Find ${limit} fashion products matching this search:\n\n`;
    prompt += `Search: "${query.terms}"\n`;

    if (query.gender) {
      prompt += `Gender: ${query.gender}\n`;
    }

    if (query.category) {
      prompt += `Category: ${query.category}\n`;
    }

    if (query.minPrice || query.maxPrice) {
      prompt += `Price range: $${query.minPrice || 0} - $${query.maxPrice || 'unlimited'}\n`;
    }

    if (query.brands?.length) {
      prompt += `Preferred brands: ${query.brands.join(', ')}\n`;
    }

    if (query.color?.length) {
      prompt += `Colors: ${query.color.join(', ')}\n`;
    }

    if (query.occasion) {
      prompt += `Occasion: ${query.occasion}\n`;
    }

    if (query.style) {
      prompt += `Style: ${query.style}\n`;
    }

    prompt += `\nReturn the products as JSON. Focus on currently available items from reputable retailers.`;

    return prompt;
  }

  /**
   * Parse Claude's response into Product objects
   */
  private parseResponse(text: string, query: SearchQuery): Product[] {
    try {
      // Extract JSON from response
      let jsonText = text;

      // Try to find JSON in markdown code blocks
      const codeBlockMatch = text.match(/```json\s*\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1];
      } else {
        // Try to find raw JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonText = jsonMatch[0];
        }
      }

      const parsed = JSON.parse(jsonText);
      const items = parsed.products || [];

      const products: Product[] = [];

      for (const item of items) {
        try {
          // Apply price filter
          if (query.minPrice && item.price < query.minPrice) continue;
          if (query.maxPrice && item.price > query.maxPrice) continue;

          const product = normalizeProduct(
            {
              id: this.generateId(item.title, item.retailer),
              title: item.title,
              brand: item.brand,
              retailer: item.retailer || 'Various',
              price: item.price || 0,
              originalPrice: item.originalPrice,
              onSale: item.onSale || false,
              image: item.imageUrl || '',
              url: item.productUrl || '',
              description: item.description,
              color: item.color,
              category: item.category,
              inStock: item.inStock !== false,
            },
            SearchSource.CLAUDE_WEB,
          );

          products.push(product);
        } catch (error) {
          this.logger.warn(`Failed to parse Claude product: ${(error as Error).message}`);
        }
      }

      return products;
    } catch (error) {
      this.logger.error(`Failed to parse Claude response: ${(error as Error).message}`);
      this.logger.debug('Raw response:', text);
      return [];
    }
  }

  /**
   * Generate unique ID from title and retailer
   */
  private generateId(title: string, retailer: string): string {
    const combined = `${retailer}-${title}`;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
      const char = combined.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `claude-${Math.abs(hash)}`;
  }

  /**
   * Health check - verify Claude API is accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say "OK"' }],
      });
      return true;
    } catch {
      return false;
    }
  }
}
