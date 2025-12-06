import { Injectable, Logger } from '@nestjs/common';
import { SearchOrchestratorService } from '../../search/search-orchestrator.service';
import { buildSearchQuery } from '../../search/dto/search-query.dto';
import { Product, SearchSource } from '../../search/dto/product.dto';
import { AgentResponse, ResponseType, SuggestedAction } from '../dto/chat-message.dto';
import { RoutingDecision } from './intent-router.service';
import { ProductRepository } from '../../products/infrastructure/persistence/product.repository';
import { Product as ProductSchema, ProductSource } from '../../products/domain/schemas/product.schema';

/**
 * Search Agent
 *
 * Handles product search requests from users.
 * Uses SearchOrchestratorService for multi-source product discovery.
 *
 * Responsibilities:
 * - Build search query from intent filters
 * - Execute search via orchestrator
 * - Format results for user
 * - Generate follow-up suggestions
 */
@Injectable()
export class SearchAgentService {
  private readonly logger = new Logger(SearchAgentService.name);

  constructor(
    private searchOrchestrator: SearchOrchestratorService,
    private productRepository: ProductRepository,
  ) {}

  /**
   * Execute search based on routing decision
   * ENHANCED: Implements fallback search with relaxed constraints when initial search returns no results
   */
  async execute(
    message: string,
    routing: RoutingDecision,
    userContext?: any,
  ): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      // Build search query from routing filters
      const searchQuery = buildSearchQuery(
        message,
        routing.filters,
        userContext,
      );

      this.logger.log(`Executing search: "${searchQuery.terms}"`);

      // Execute search
      let searchResult = await this.searchOrchestrator.search(
        searchQuery,
        userContext,
      );

      // FALLBACK SEARCH: If no results and we have restrictive filters, try relaxing them
      if (searchResult.products.length === 0) {
        this.logger.log(`No results found, attempting fallback search with relaxed constraints`);

        const fallbackResult = await this.executeWithFallback(
          message,
          routing,
          searchQuery,
          userContext,
        );

        if (fallbackResult) {
          searchResult = fallbackResult;
        }
      }

      // Check if we found products
      if (searchResult.products.length === 0) {
        return this.buildNoResultsResponse(message, searchQuery);
      }

      // Format response
      const response = this.formatSearchResponse(
        message,
        searchResult.products,
        searchResult,
      );

      // Add metadata
      response.metadata = {
        intent: routing.intent,
        confidence: routing.confidence,
        agentUsed: 'search',
        processingTime: Date.now() - startTime,
        sources: searchResult.sources,
      };

      this.logger.log(
        `Search completed: ${searchResult.products.length} products in ${Date.now() - startTime}ms`,
      );

      return response;
    } catch (error) {
      this.logger.error(`Search agent failed: ${(error as Error).message}`);

      return {
        message: "I'm having trouble finding products right now. Could you try rephrasing your request?",
        type: ResponseType.ERROR,
        metadata: {
          intent: routing.intent,
          confidence: routing.confidence,
          agentUsed: 'search',
          processingTime: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Format search results into user-friendly response
   */
  private formatSearchResponse(
    query: string,
    products: Product[],
    searchResult: any,
  ): AgentResponse {
    // Generate natural response message
    const message = this.generateResponseMessage(query, products.length);

    // Generate suggested actions
    const suggestedActions = this.generateSuggestedActions(products);

    return {
      message,
      type: ResponseType.PRODUCT_LIST,
      data: {
        products: products.map((p) => this.formatProduct(p)),
        totalFound: searchResult.totalFound,
        showing: products.length,
      },
      suggestedActions,
    };
  }

  /**
   * Generate natural response message
   */
  private generateResponseMessage(query: string, count: number): string {
    if (count === 1) {
      return `I found 1 product for you!`;
    } else if (count <= 5) {
      return `I found ${count} great options for you!`;
    } else if (count <= 20) {
      return `Here are ${count} products I think you'll love!`;
    } else {
      return `I found ${count} products! Here are the top picks for you.`;
    }
  }

  /**
   * Format product for response
   * Maps to Python frontend's expected format for compatibility
   */
  private formatProduct(product: Product): any {
    return {
      // Python frontend compatibility fields
      product_id: product.id,
      name: product.title,
      url: product.productUrl,
      image_url: product.imageUrl,
      price: product.price ? `$${product.price.toFixed(2)}` : 'Price unavailable',
      category: product.category || 'fashion',
      retailer: product.retailer,

      // Additional fields for enhanced frontend
      id: product.id,
      title: product.title,
      brand: product.brand,
      originalPrice: product.originalPrice,
      onSale: product.onSale,
      discount: product.discount,
      imageUrl: product.imageUrl,
      productUrl: product.productUrl,
      affiliateUrl: product.affiliateUrl,
      rating: product.rating,
      reviewCount: product.reviewCount,
      inStock: product.inStock,
      score: product.score,
    };
  }

  /**
   * Generate suggested follow-up actions
   */
  private generateSuggestedActions(products: Product[]): SuggestedAction[] {
    const actions: SuggestedAction[] = [];

    // Suggest building an outfit if showing clothing
    const hasClothing = products.some(
      (p) =>
        p.category === 'dress' ||
        p.category === 'top' ||
        p.category === 'bottom',
    );

    if (hasClothing) {
      actions.push({
        label: 'Build an outfit',
        action: 'create_outfit',
        data: { productIds: products.slice(0, 5).map((p) => p.id) },
      });
    }

    // Suggest filtering
    actions.push({
      label: 'Refine search',
      action: 'refine_search',
    });

    // Suggest similar items
    if (products.length > 0) {
      actions.push({
        label: 'Show similar items',
        action: 'similar_items',
        data: { productId: products[0].id },
      });
    }

    return actions;
  }

  /**
   * Build response when no results found
   */
  private buildNoResultsResponse(
    query: string,
    searchQuery: any,
  ): AgentResponse {
    let message = "I couldn't find any products matching your request. ";

    // Add helpful suggestions based on filters
    if (searchQuery.brands?.length) {
      message += `Try searching without specific brands, or `;
    }

    if (searchQuery.minPrice || searchQuery.maxPrice) {
      message += `try adjusting your price range, or `;
    }

    message += `try using different keywords.`;

    return {
      message,
      type: ResponseType.TEXT,
      suggestedActions: [
        {
          label: 'Browse all products',
          action: 'browse_all',
        },
        {
          label: 'Try different search',
          action: 'new_search',
        },
      ],
    };
  }

  /**
   * Execute fallback search with progressively relaxed constraints
   * Strategy:
   * 1. First try: Remove price constraints (budget might be too restrictive)
   * 2. Second try: Simplify search terms (keep only itemType)
   * 3. Third try: Broaden category search
   */
  private async executeWithFallback(
    message: string,
    routing: RoutingDecision,
    originalQuery: any,
    userContext?: any,
  ): Promise<any | null> {
    const fallbackStrategies = [
      // Strategy 1: Remove price constraints
      () => {
        if (originalQuery.maxPrice || originalQuery.minPrice) {
          this.logger.log('Fallback 1: Removing price constraints');
          return {
            ...originalQuery,
            maxPrice: undefined,
            minPrice: undefined,
          };
        }
        return null;
      },

      // Strategy 2: Simplify to just itemType
      () => {
        if (routing.filters.itemType) {
          this.logger.log('Fallback 2: Simplifying to just itemType');
          return {
            ...originalQuery,
            terms: routing.filters.itemType,
            maxPrice: undefined,
            minPrice: undefined,
            color: undefined,
            style: undefined,
          };
        }
        return null;
      },

      // Strategy 3: Use broader search terms
      () => {
        const itemType = routing.filters.itemType;
        if (itemType) {
          // Extract base category from itemType (e.g., "cocktail dress" -> "dress")
          const baseCategories = ['dress', 'shirt', 'pants', 'jeans', 'skirt', 'top', 'jacket', 'coat', 'shoes', 'heels', 'boots'];
          const matchedCategory = baseCategories.find(cat => itemType.toLowerCase().includes(cat));

          if (matchedCategory) {
            this.logger.log(`Fallback 3: Broadening to category "${matchedCategory}"`);
            return {
              ...originalQuery,
              terms: matchedCategory,
              itemType: matchedCategory,
              maxPrice: undefined,
              minPrice: undefined,
              color: undefined,
              style: undefined,
              occasion: undefined,
            };
          }
        }
        return null;
      },
    ];

    // Try each fallback strategy
    for (const strategy of fallbackStrategies) {
      const fallbackQuery = strategy();

      if (fallbackQuery) {
        try {
          const result = await this.searchOrchestrator.search(fallbackQuery, userContext);

          if (result.products.length > 0) {
            this.logger.log(`Fallback search succeeded with ${result.products.length} products`);
            return result;
          }
        } catch (error) {
          this.logger.warn(`Fallback search failed: ${(error as Error).message}`);
        }
      }
    }

    return null;
  }

  /**
   * Get product details by ID
   * Retrieves product from database by MongoDB ObjectId or external ID
   */
  async getProductDetails(productId: string): Promise<Product | null> {
    this.logger.debug(`Getting product details for ${productId}`);

    try {
      // Try finding by MongoDB ObjectId first
      let productDoc = await this.productRepository.findById(productId);

      // If not found, try by external ID
      if (!productDoc) {
        productDoc = await this.productRepository.findByExternalId(productId);
      }

      if (!productDoc) {
        this.logger.debug(`Product ${productId} not found in database`);
        return null;
      }

      // Track view for analytics
      await this.productRepository.incrementViewCount((productDoc as any)._id.toString());

      // Map to DTO
      return this.mapSchemaToDto(productDoc);
    } catch (error) {
      this.logger.error(`Error getting product details: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Find similar products
   * Uses attribute-based similarity (category, price range, style tags)
   */
  async findSimilar(
    productId: string,
    userContext?: any,
  ): Promise<Product[]> {
    this.logger.debug(`Finding similar products to ${productId}`);

    try {
      // Get similar products from repository (uses attribute-based matching)
      const similarProducts = await this.productRepository.findSimilarByAttributes(
        productId,
        10, // limit to 10 similar products
      );

      if (similarProducts.length === 0) {
        this.logger.debug(`No similar products found for ${productId}`);
        return [];
      }

      // Map to DTOs
      return similarProducts.map((product) => this.mapSchemaToDto(product));
    } catch (error) {
      this.logger.error(`Error finding similar products: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Convert ProductSource (schema) to SearchSource (DTO)
   */
  private mapSourceToSearchSource(source: ProductSource): SearchSource {
    const sourceMap: Record<ProductSource, SearchSource> = {
      [ProductSource.OXYLABS]: SearchSource.OXYLABS,
      [ProductSource.SHOPSTYLE]: SearchSource.SHOPSTYLE,
      [ProductSource.SERPAPI]: SearchSource.SERPAPI,
      [ProductSource.GOOGLE_SHOPPING]: SearchSource.GOOGLE_SHOPPING,
      [ProductSource.ASOS_SCRAPER]: SearchSource.ASOS_SCRAPER,
      [ProductSource.ASOS_API]: SearchSource.ASOS_SCRAPER, // Map API to scraper source type
      [ProductSource.ZARA_SCRAPER]: SearchSource.ZARA_SCRAPER,
      [ProductSource.HM_SCRAPER]: SearchSource.HM_SCRAPER,
      [ProductSource.BRAVE_SEARCH]: SearchSource.BRAVE_SEARCH,
      [ProductSource.WALMART]: SearchSource.WALMART,
      [ProductSource.TARGET]: SearchSource.TARGET,
      [ProductSource.CLAUDE_WEB]: SearchSource.CLAUDE_WEB,
      [ProductSource.CACHE]: SearchSource.CACHE,
      [ProductSource.MANUAL]: SearchSource.CACHE, // Map MANUAL to CACHE as fallback
    };
    return sourceMap[source] || SearchSource.CACHE;
  }

  /**
   * Map ProductSchema (MongoDB document) to Product DTO
   */
  private mapSchemaToDto(product: ProductSchema): Product {
    return {
      id: (product as any)._id.toString(),
      sourceId: product.sourceId,
      source: this.mapSourceToSearchSource(product.source),
      title: product.title,
      description: product.description,
      brand: product.brand,
      retailer: product.retailer,
      category: product.category,
      color: product.color,
      price: product.pricing.current,
      originalPrice: product.pricing.original,
      currency: product.pricing.currency,
      onSale: product.pricing.onSale,
      discount: product.pricing.discountPercent,
      imageUrl: product.images.primary,
      images: product.images.gallery,
      thumbnail: product.images.thumbnail,
      productUrl: product.productUrl,
      affiliateUrl: product.affiliateUrl,
      rating: product.rating?.average,
      reviewCount: product.rating?.count,
      inStock: product.availability.inStock,
      stockLevel: product.availability.stockLevel,
      sizes: product.availability.sizes,
      colors: product.availability.colors,
      tags: product.style?.tags,
      pattern: product.style?.pattern,
      material: product.style?.material,
      sustainable: product.style?.sustainable,
      score: product.searchMeta?.relevanceScore,
      scrapedAt: product.scrapedAt,
    };
  }
}
