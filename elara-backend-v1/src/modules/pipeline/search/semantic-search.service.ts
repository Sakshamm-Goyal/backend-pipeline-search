import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from '../embeddings/embedding.service';
import { ProductRepository } from '../products/infrastructure/persistence/product.repository';
import { Product as ProductDoc } from '../products/domain/schemas/product.schema';
import { Product } from './dto/product.dto';

/**
 * Semantic Search Service
 *
 * Provides semantic/vector search capabilities for products and wardrobe items.
 * Uses embeddings for similarity matching beyond keyword search.
 *
 * Features:
 * - Query embedding generation
 * - Vector similarity search
 * - Hybrid search (keyword + semantic)
 * - Similar item recommendations
 */

export interface SemanticSearchResult {
  product: ProductDoc;
  similarity: number;
  matchType: 'semantic' | 'keyword' | 'hybrid';
}

export interface SemanticSearchOptions {
  limit?: number;
  minSimilarity?: number;
  filters?: {
    categories?: string[];
    brands?: string[];
    minPrice?: number;
    maxPrice?: number;
  };
  useHybrid?: boolean; // Combine with keyword search
}

@Injectable()
export class SemanticSearchService {
  private readonly logger = new Logger(SemanticSearchService.name);

  constructor(
    private embeddingService: EmbeddingService,
    private productRepository: ProductRepository,
  ) {}

  /**
   * Perform semantic search on products
   */
  async searchProducts(
    query: string,
    options: SemanticSearchOptions = {},
  ): Promise<SemanticSearchResult[]> {
    const {
      limit = 20,
      minSimilarity = 0.7,
      filters,
      useHybrid = true,
    } = options;

    if (!this.embeddingService.isAvailable()) {
      this.logger.warn('Embedding service not available, falling back to text search');
      return this.fallbackTextSearch(query, limit, filters);
    }

    try {
      // Generate embedding for the query
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);

      if (!queryEmbedding) {
        this.logger.warn('Failed to generate query embedding, falling back to text search');
        return this.fallbackTextSearch(query, limit, filters);
      }

      // Vector search
      const vectorResults = await this.productRepository.findSimilarByVector(
        queryEmbedding.embedding,
        limit * 2, // Get more for filtering
      );

      // If no vector results or using hybrid, also do text search
      let textResults: ProductDoc[] = [];
      if (useHybrid || vectorResults.length === 0) {
        const textSearchResult = await this.productRepository.textSearch(
          query,
          {
            categories: filters?.categories?.map((c) => c as any),
            brands: filters?.brands,
            minPrice: filters?.minPrice,
            maxPrice: filters?.maxPrice,
          },
          1,
          limit,
        );
        textResults = textSearchResult.products;
      }

      // Combine and deduplicate results
      const combinedResults = this.combineResults(
        vectorResults,
        textResults,
        minSimilarity,
        limit,
      );

      this.logger.log(
        `Semantic search for "${query}": ${combinedResults.length} results`,
      );

      return combinedResults;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Semantic search failed: ${err.message}`, err.stack);
      return this.fallbackTextSearch(query, limit, filters);
    }
  }

  /**
   * Find similar products to a given product
   */
  async findSimilarProducts(
    productId: string,
    limit: number = 10,
  ): Promise<SemanticSearchResult[]> {
    try {
      const product = await this.productRepository.findById(productId);

      if (!product) {
        return [];
      }

      // If product has embedding, use vector search
      if (product.embedding?.vector?.length) {
        const results = await this.productRepository.findSimilarByVector(
          product.embedding.vector,
          limit + 1, // +1 because it might include itself
          [productId],
        );

        return results.map((r) => ({
          product: r.product,
          similarity: r.similarity,
          matchType: 'semantic' as const,
        }));
      }

      // Fall back to attribute-based similarity
      const similar = await this.productRepository.findSimilarByAttributes(
        productId,
        limit,
      );

      return similar.map((p) => ({
        product: p,
        similarity: 0.7, // Estimated similarity
        matchType: 'keyword' as const,
      }));
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Find similar failed: ${err.message}`, err.stack);
      return [];
    }
  }

  /**
   * Search by natural language description
   */
  async searchByDescription(
    description: string,
    options: SemanticSearchOptions = {},
  ): Promise<SemanticSearchResult[]> {
    // Enhance the description for better embedding
    const enhancedQuery = `Fashion item: ${description}`;
    return this.searchProducts(enhancedQuery, options);
  }

  /**
   * Find products that complement a wardrobe item
   */
  async findComplementaryProducts(
    wardrobeItemDescription: string,
    category: string,
    options: SemanticSearchOptions = {},
  ): Promise<SemanticSearchResult[]> {
    // Create a query for complementary items
    const complementQuery = `Find ${category} that pairs well with: ${wardrobeItemDescription}`;
    return this.searchProducts(complementQuery, options);
  }

  /**
   * Calculate similarity between two texts
   */
  async calculateTextSimilarity(text1: string, text2: string): Promise<number> {
    if (!this.embeddingService.isAvailable()) {
      return 0;
    }

    try {
      const result = await this.embeddingService.generateBatchEmbeddings([text1, text2]);

      if (!result || result.embeddings.length < 2) {
        return 0;
      }

      return this.embeddingService.cosineSimilarity(
        result.embeddings[0].embedding,
        result.embeddings[1].embedding,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Similarity calculation failed: ${err.message}`);
      return 0;
    }
  }

  /**
   * Combine vector and text search results
   */
  private combineResults(
    vectorResults: Array<{ product: ProductDoc; similarity: number }>,
    textResults: ProductDoc[],
    minSimilarity: number,
    limit: number,
  ): SemanticSearchResult[] {
    const resultsMap = new Map<string, SemanticSearchResult>();

    // Add vector results
    for (const result of vectorResults) {
      if (result.similarity >= minSimilarity) {
        const id = (result.product as any)._id.toString();
        resultsMap.set(id, {
          product: result.product,
          similarity: result.similarity,
          matchType: 'semantic',
        });
      }
    }

    // Add/update with text results
    for (const product of textResults) {
      const id = (product as any)._id.toString();
      if (resultsMap.has(id)) {
        // Boost if found in both
        const existing = resultsMap.get(id)!;
        existing.similarity = Math.min(1, existing.similarity * 1.1);
        existing.matchType = 'hybrid';
      } else {
        resultsMap.set(id, {
          product,
          similarity: 0.65, // Text match estimated similarity
          matchType: 'keyword',
        });
      }
    }

    // Sort by similarity and limit
    const results = Array.from(resultsMap.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
  }

  /**
   * Fallback to text-only search
   */
  private async fallbackTextSearch(
    query: string,
    limit: number,
    filters?: SemanticSearchOptions['filters'],
  ): Promise<SemanticSearchResult[]> {
    try {
      const result = await this.productRepository.textSearch(
        query,
        {
          categories: filters?.categories?.map((c) => c as any),
          brands: filters?.brands,
          minPrice: filters?.minPrice,
          maxPrice: filters?.maxPrice,
        },
        1,
        limit,
      );

      return result.products.map((product) => ({
        product,
        similarity: 0.65,
        matchType: 'keyword' as const,
      }));
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Fallback text search failed: ${err.message}`);
      return [];
    }
  }
}
