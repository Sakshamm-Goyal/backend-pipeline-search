import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EmbeddingService } from '../embeddings/embedding.service';
import { WardrobeRepository } from '../../wardrobe/infrastructure/repositories/wardrobe.repository';
import { WardrobeItem } from '../../wardrobe/domain/schemas/wardrobe-item.schema';

/**
 * Wardrobe Embedding Processor
 *
 * Background job that generates embeddings for wardrobe items.
 * Runs periodically to process items that don't have embeddings yet.
 *
 * Flow:
 * 1. Find wardrobe items without embeddings
 * 2. Generate embedding text from item attributes
 * 3. Call OpenAI embedding API
 * 4. Store embedding vector in the database
 *
 * Features:
 * - Batch processing for efficiency
 * - Rate limit aware
 * - Retry logic for failed items
 * - Non-blocking background execution
 */
@Injectable()
export class WardrobeEmbeddingProcessorService {
  private readonly logger = new Logger(WardrobeEmbeddingProcessorService.name);
  private isProcessing = false;

  // Processing configuration
  private readonly BATCH_SIZE = 50; // Items per batch
  private readonly MAX_RETRIES = 3;

  constructor(
    private embeddingService: EmbeddingService,
    private wardrobeRepository: WardrobeRepository,
  ) {}

  /**
   * Scheduled job - runs every 5 minutes
   * Processes wardrobe items that need embeddings
   */
  @Cron('*/5 * * * *')
  async processEmbeddingQueue(): Promise<void> {
    if (this.isProcessing) {
      this.logger.debug('Embedding processor already running, skipping');
      return;
    }

    if (!this.embeddingService.isAvailable()) {
      this.logger.debug('Embedding service not available, skipping');
      return;
    }

    this.isProcessing = true;

    try {
      // Get items without embeddings
      const items = await this.wardrobeRepository.findWithoutEmbeddings(
        this.BATCH_SIZE,
      );

      if (items.length === 0) {
        this.logger.debug('No items need embedding processing');
        return;
      }

      this.logger.log(`Processing embeddings for ${items.length} wardrobe items`);

      // Process in batch
      const results = await this.processBatch(items);

      this.logger.log(
        `Embedding processing complete: ${results.success} succeeded, ${results.failed} failed`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Embedding queue processing failed: ${err.message}`, err.stack);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a batch of wardrobe items
   */
  private async processBatch(
    items: WardrobeItem[],
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    // Generate embedding texts for all items
    const textsWithIds = items.map((item: WardrobeItem) => ({
      id: (item as any)._id.toString(),
      text: this.generateEmbeddingText(item),
    }));

    // Get batch embeddings from OpenAI
    const batchResult = await this.embeddingService.generateBatchEmbeddings(
      textsWithIds.map((t) => t.text),
    );

    if (!batchResult) {
      this.logger.error('Batch embedding generation returned null');
      return { success: 0, failed: items.length };
    }

    // Store embeddings in database
    for (let i = 0; i < batchResult.embeddings.length; i++) {
      const itemId = textsWithIds[i].id;
      const embedding = batchResult.embeddings[i];

      try {
        await this.wardrobeRepository.updateEmbedding(itemId, {
          vector: embedding.embedding,
          model: embedding.model,
          inputText: embedding.text,
        });
        success++;
      } catch (error) {
        const err = error as Error;
        this.logger.error(
          `Failed to store embedding for item ${itemId}: ${err.message}`,
        );
        failed++;
      }
    }

    return { success, failed };
  }

  /**
   * Generate embedding text from wardrobe item
   */
  private generateEmbeddingText(item: WardrobeItem): string {
    return this.embeddingService.generateWardrobeEmbeddingText({
      category: item.category,
      subcategory: item.subcategory,
      name: item.name,
      color: item.aiAnalysis?.dominantColor,
      pattern: item.aiAnalysis?.pattern,
      material: item.aiAnalysis?.material,
      style: item.aiAnalysis?.style,
      occasions: item.aiAnalysis?.occasion?.map((o) => o.toString()),
      brand: item.brand,
    });
  }

  /**
   * Manually trigger embedding generation for a specific item
   */
  async generateEmbeddingForItem(itemId: string): Promise<boolean> {
    try {
      // Get item from database
      const item = await this.wardrobeRepository.findById(itemId);

      if (!item) {
        this.logger.warn(`Item ${itemId} not found`);
        return false;
      }

      // Generate embedding text
      const text = this.generateEmbeddingText(item);

      // Generate embedding
      const result = await this.embeddingService.generateEmbedding(text);

      if (!result) {
        this.logger.error(`Failed to generate embedding for item ${itemId}`);
        return false;
      }

      // Store embedding
      await this.wardrobeRepository.updateEmbedding(itemId, {
        vector: result.embedding,
        model: result.model,
        inputText: text,
      });

      this.logger.log(`Generated embedding for item ${itemId}`);
      return true;
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Error generating embedding for item ${itemId}: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Find similar items using embedding similarity
   */
  async findSimilarItems(
    itemId: string,
    limit: number = 10,
  ): Promise<Array<{ id: string; similarity: number }>> {
    try {
      // Get the source item
      const sourceItem = await this.wardrobeRepository.findById(itemId);

      if (!sourceItem?.embedding?.vector) {
        this.logger.warn(`Item ${itemId} has no embedding`);
        return [];
      }

      // Find similar items using vector search
      const similarItems = await this.wardrobeRepository.findSimilarByVector(
        sourceItem.embedding.vector,
        limit + 1, // +1 to account for the source item
        [itemId], // Exclude source item
      );

      return similarItems
        .slice(0, limit)
        .map((result) => ({
          id: (result.item as any)._id.toString(),
          similarity: result.similarity,
        }));
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error finding similar items: ${err.message}`);
      return [];
    }
  }

  /**
   * Get embedding stats
   */
  async getStats(): Promise<{
    totalItems: number;
    withEmbeddings: number;
    withoutEmbeddings: number;
    percentComplete: number;
  }> {
    try {
      const stats = await this.wardrobeRepository.getEmbeddingStats();
      return stats;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting embedding stats: ${err.message}`);
      return {
        totalItems: 0,
        withEmbeddings: 0,
        withoutEmbeddings: 0,
        percentComplete: 0,
      };
    }
  }
}
