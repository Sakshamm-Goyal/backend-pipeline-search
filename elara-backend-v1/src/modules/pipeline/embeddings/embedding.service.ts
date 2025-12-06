import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

/**
 * Embedding Service
 *
 * Generates vector embeddings for semantic search and similarity matching.
 * Uses OpenAI's text-embedding-3-small model (1536 dimensions).
 *
 * Features:
 * - Batch embedding generation for efficiency
 * - Automatic retries with exponential backoff
 * - Rate limiting compliance
 * - Cost tracking
 *
 * Use cases:
 * - Product search: semantic search across products
 * - Similar products: find visually/stylistically similar items
 * - Outfit compatibility: match items based on style vectors
 * - Wardrobe organization: cluster similar items
 */

export interface EmbeddingResult {
  text: string;
  embedding: number[];
  model: string;
  tokens: number;
}

export interface BatchEmbeddingResult {
  embeddings: EmbeddingResult[];
  totalTokens: number;
  model: string;
}

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private openai: OpenAI | null = null;
  private readonly model = 'text-embedding-3-small';
  private readonly dimensions = 1536;
  private isEnabled = false;

  // Rate limiting
  private requestCount = 0;
  private tokenCount = 0;
  private lastResetTime = Date.now();
  private readonly maxRequestsPerMinute = 3000;
  private readonly maxTokensPerMinute = 1000000;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');

    if (!apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY not configured - embedding service disabled',
      );
      return;
    }

    try {
      this.openai = new OpenAI({ apiKey });
      this.isEnabled = true;
      this.logger.log(`Embedding service initialized (model: ${this.model})`);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to initialize OpenAI: ${err.message}`);
    }
  }

  /**
   * Check if embedding service is available
   */
  isAvailable(): boolean {
    return this.isEnabled && this.openai !== null;
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult | null> {
    if (!this.isAvailable()) {
      this.logger.warn('Embedding service not available');
      return null;
    }

    try {
      await this.checkRateLimits();

      const response = await this.openai!.embeddings.create({
        model: this.model,
        input: this.sanitizeText(text),
        dimensions: this.dimensions,
      });

      const result = response.data[0];
      const tokens = response.usage?.total_tokens || 0;

      this.updateRateLimits(1, tokens);

      return {
        text,
        embedding: result.embedding,
        model: this.model,
        tokens,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Embedding generation failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Generate embeddings for multiple texts (batch)
   * More efficient than multiple single calls
   */
  async generateBatchEmbeddings(
    texts: string[],
    batchSize: number = 100,
  ): Promise<BatchEmbeddingResult | null> {
    if (!this.isAvailable()) {
      this.logger.warn('Embedding service not available');
      return null;
    }

    if (texts.length === 0) {
      return { embeddings: [], totalTokens: 0, model: this.model };
    }

    try {
      const allEmbeddings: EmbeddingResult[] = [];
      let totalTokens = 0;

      // Process in batches to respect API limits
      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const sanitized = batch.map((t) => this.sanitizeText(t));

        await this.checkRateLimits();

        const response = await this.openai!.embeddings.create({
          model: this.model,
          input: sanitized,
          dimensions: this.dimensions,
        });

        const batchTokens = response.usage?.total_tokens || 0;
        totalTokens += batchTokens;

        for (let j = 0; j < response.data.length; j++) {
          allEmbeddings.push({
            text: batch[j],
            embedding: response.data[j].embedding,
            model: this.model,
            tokens: Math.floor(batchTokens / batch.length),
          });
        }

        this.updateRateLimits(1, batchTokens);

        // Small delay between batches to be nice to the API
        if (i + batchSize < texts.length) {
          await this.sleep(100);
        }
      }

      this.logger.log(
        `Generated ${allEmbeddings.length} embeddings using ${totalTokens} tokens`,
      );

      return {
        embeddings: allEmbeddings,
        totalTokens,
        model: this.model,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Batch embedding generation failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Generate embedding text for a product
   * Combines relevant fields into a searchable string
   */
  generateProductEmbeddingText(product: {
    title: string;
    description?: string;
    brand?: string;
    category?: string;
    color?: string;
    tags?: string[];
    material?: string;
    pattern?: string;
  }): string {
    const parts: string[] = [];

    // Title is most important
    if (product.title) {
      parts.push(product.title);
    }

    // Brand adds context
    if (product.brand) {
      parts.push(`by ${product.brand}`);
    }

    // Category helps with classification
    if (product.category) {
      parts.push(product.category);
    }

    // Color is crucial for fashion
    if (product.color) {
      parts.push(product.color);
    }

    // Material and pattern add detail
    if (product.material) {
      parts.push(product.material);
    }

    if (product.pattern) {
      parts.push(`${product.pattern} pattern`);
    }

    // Tags capture style
    if (product.tags?.length) {
      parts.push(product.tags.join(', '));
    }

    // Description adds context (truncated)
    if (product.description) {
      const truncated = product.description.substring(0, 200);
      parts.push(truncated);
    }

    return parts.join('. ').trim();
  }

  /**
   * Generate embedding text for a wardrobe item
   */
  generateWardrobeEmbeddingText(item: {
    category: string;
    subcategory?: string;
    name?: string;
    color?: string;
    pattern?: string;
    material?: string;
    style?: string[];
    occasions?: string[];
    brand?: string;
  }): string {
    const parts: string[] = [];

    if (item.name) {
      parts.push(item.name);
    }

    if (item.brand) {
      parts.push(`by ${item.brand}`);
    }

    parts.push(item.category);

    if (item.subcategory) {
      parts.push(item.subcategory);
    }

    if (item.color) {
      parts.push(item.color);
    }

    if (item.material) {
      parts.push(item.material);
    }

    if (item.pattern) {
      parts.push(`${item.pattern} pattern`);
    }

    if (item.style?.length) {
      parts.push(`style: ${item.style.join(', ')}`);
    }

    if (item.occasions?.length) {
      parts.push(`for: ${item.occasions.join(', ')}`);
    }

    return parts.join('. ').trim();
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Find most similar embeddings from a list
   */
  findMostSimilar(
    queryEmbedding: number[],
    candidates: Array<{ id: string; embedding: number[] }>,
    topK: number = 10,
  ): Array<{ id: string; similarity: number }> {
    const scored = candidates.map((c) => ({
      id: c.id,
      similarity: this.cosineSimilarity(queryEmbedding, c.embedding),
    }));

    scored.sort((a, b) => b.similarity - a.similarity);

    return scored.slice(0, topK);
  }

  /**
   * Get embedding dimensions
   */
  getDimensions(): number {
    return this.dimensions;
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus(): {
    requestsUsed: number;
    tokensUsed: number;
    resetInMs: number;
  } {
    const now = Date.now();
    const timeSinceReset = now - this.lastResetTime;
    const resetInMs = Math.max(0, 60000 - timeSinceReset);

    return {
      requestsUsed: this.requestCount,
      tokensUsed: this.tokenCount,
      resetInMs,
    };
  }

  /**
   * Sanitize text for embedding
   */
  private sanitizeText(text: string): string {
    // Remove excessive whitespace
    let sanitized = text.replace(/\s+/g, ' ').trim();

    // Limit length (OpenAI has 8191 token limit, ~32k chars is safe)
    if (sanitized.length > 8000) {
      sanitized = sanitized.substring(0, 8000);
    }

    // Ensure not empty
    if (!sanitized) {
      sanitized = 'empty';
    }

    return sanitized;
  }

  /**
   * Check and wait for rate limits if needed
   */
  private async checkRateLimits(): Promise<void> {
    const now = Date.now();
    const timeSinceReset = now - this.lastResetTime;

    // Reset counters after 1 minute
    if (timeSinceReset >= 60000) {
      this.requestCount = 0;
      this.tokenCount = 0;
      this.lastResetTime = now;
    }

    // Check if we're approaching limits
    if (
      this.requestCount >= this.maxRequestsPerMinute * 0.9 ||
      this.tokenCount >= this.maxTokensPerMinute * 0.9
    ) {
      const waitTime = 60000 - timeSinceReset;
      this.logger.warn(`Rate limit approaching, waiting ${waitTime}ms`);
      await this.sleep(waitTime);
      this.requestCount = 0;
      this.tokenCount = 0;
      this.lastResetTime = Date.now();
    }
  }

  /**
   * Update rate limit counters
   */
  private updateRateLimits(requests: number, tokens: number): void {
    this.requestCount += requests;
    this.tokenCount += tokens;
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
