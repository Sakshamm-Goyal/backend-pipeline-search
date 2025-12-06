import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';
import { ProductRepository } from '../products/infrastructure/persistence/product.repository';
import { Product, ProductEmbedding } from '../products/domain/schemas/product.schema';

/**
 * Embedding Processor Service
 *
 * Background job that processes products without embeddings.
 * Runs periodically to generate embeddings for new products.
 *
 * Features:
 * - Non-blocking background processing
 * - Batch processing for efficiency
 * - Automatic retry on failure
 * - Rate limiting aware
 */
@Injectable()
export class EmbeddingProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmbeddingProcessorService.name);
  private processingInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  // Configuration
  private readonly batchSize = 50;
  private readonly intervalMs = 60000; // Process every minute
  private isEnabled = false;

  constructor(
    private config: ConfigService,
    private embeddingService: EmbeddingService,
    private productRepository: ProductRepository,
  ) {}

  async onModuleInit() {
    const enabled = this.config.get<string>('ENABLE_EMBEDDING_PROCESSOR') !== 'false';

    if (!enabled) {
      this.logger.log('Embedding processor disabled by configuration');
      return;
    }

    if (!this.embeddingService.isAvailable()) {
      this.logger.warn('Embedding service not available - processor disabled');
      return;
    }

    this.isEnabled = true;
    this.startProcessing();
  }

  onModuleDestroy() {
    this.stopProcessing();
  }

  /**
   * Start periodic processing
   */
  private startProcessing(): void {
    if (this.processingInterval) return;

    this.logger.log(
      `Starting embedding processor (batch: ${this.batchSize}, interval: ${this.intervalMs}ms)`,
    );

    // Initial run after 5 seconds
    setTimeout(() => this.processUnembeddedProducts(), 5000);

    // Periodic runs
    this.processingInterval = setInterval(
      () => this.processUnembeddedProducts(),
      this.intervalMs,
    );
  }

  /**
   * Stop periodic processing
   */
  private stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      this.logger.log('Embedding processor stopped');
    }
  }

  /**
   * Process products without embeddings
   */
  async processUnembeddedProducts(): Promise<void> {
    if (this.isProcessing) {
      this.logger.debug('Already processing, skipping');
      return;
    }

    this.isProcessing = true;

    try {
      // Find products without embeddings
      const products = await this.productRepository.findWithoutEmbeddings(
        this.batchSize,
      );

      if (products.length === 0) {
        this.logger.debug('No products to process');
        return;
      }

      this.logger.log(`Processing ${products.length} products for embeddings`);

      // Generate embedding texts
      const texts = products.map((p) =>
        this.embeddingService.generateProductEmbeddingText({
          title: p.title,
          description: p.description,
          brand: p.brand,
          category: p.category,
          color: p.color,
          tags: p.style?.tags,
          material: p.style?.material,
          pattern: p.style?.pattern,
        }),
      );

      // Generate embeddings in batch
      const result = await this.embeddingService.generateBatchEmbeddings(texts);

      if (!result) {
        this.logger.error('Failed to generate embeddings');
        return;
      }

      // Update products with embeddings
      const updates: Array<{ productId: string; embedding: ProductEmbedding }> =
        [];

      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const embeddingResult = result.embeddings[i];

        if (embeddingResult) {
          updates.push({
            productId: (product as any)._id.toString(),
            embedding: {
              vector: embeddingResult.embedding,
              model: embeddingResult.model,
              generatedAt: new Date(),
              inputText: texts[i].substring(0, 200), // Store truncated for debugging
            },
          });
        }
      }

      if (updates.length > 0) {
        const updated = await this.productRepository.updateManyEmbeddings(updates);
        this.logger.log(
          `Updated ${updated} products with embeddings (${result.totalTokens} tokens used)`,
        );
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Embedding processing failed: ${err.message}`, err.stack);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Manually trigger processing (for testing/admin)
   */
  async triggerProcessing(): Promise<{ processed: number }> {
    if (!this.isEnabled) {
      return { processed: 0 };
    }

    await this.processUnembeddedProducts();

    // Return stats (simplified for now)
    return { processed: this.batchSize };
  }

  /**
   * Get processing stats
   */
  getStats(): {
    enabled: boolean;
    isProcessing: boolean;
    embeddingServiceAvailable: boolean;
    rateLimitStatus: any;
  } {
    return {
      enabled: this.isEnabled,
      isProcessing: this.isProcessing,
      embeddingServiceAvailable: this.embeddingService.isAvailable(),
      rateLimitStatus: this.embeddingService.getRateLimitStatus(),
    };
  }
}
