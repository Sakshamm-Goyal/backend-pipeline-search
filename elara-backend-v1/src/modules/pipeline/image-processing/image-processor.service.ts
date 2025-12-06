import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { BackgroundRemovalService } from './background-removal.service';
import { WardrobeRepository } from '../../wardrobe/infrastructure/repositories/wardrobe.repository';
import { ImageProcessingStatus } from '../../wardrobe/domain/enums/image-processing-status.enum';

/**
 * Image Processor Service
 *
 * Background job processor for wardrobe image processing tasks:
 * - Background removal
 * - Thumbnail generation
 * - Image optimization
 *
 * Runs periodically to process pending items.
 */

export interface ProcessingJob {
  itemId: string;
  userId: string;
  imageUrl: string;
  status: ImageProcessingStatus;
  retryCount: number;
}

export interface ProcessingStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  lastRunAt: Date | null;
  lastRunProcessed: number;
}

@Injectable()
export class ImageProcessorService {
  private readonly logger = new Logger(ImageProcessorService.name);

  // Processing configuration
  private readonly batchSize: number;
  private readonly maxRetries: number;
  private readonly enabled: boolean;

  // Stats tracking
  private lastRunAt: Date | null = null;
  private lastRunProcessed: number = 0;
  private isProcessing: boolean = false;

  constructor(
    private configService: ConfigService,
    private backgroundRemovalService: BackgroundRemovalService,
    private wardrobeRepository: WardrobeRepository,
  ) {
    this.batchSize = this.configService.get<number>(
      'IMAGE_PROCESSING_BATCH_SIZE',
      10,
    );
    this.maxRetries = this.configService.get<number>(
      'IMAGE_PROCESSING_MAX_RETRIES',
      3,
    );
    this.enabled =
      this.configService.get<string>('IMAGE_PROCESSING_ENABLED', 'true') ===
      'true';

    this.logger.log(
      `Image processor initialized. Enabled: ${this.enabled}, Batch size: ${this.batchSize}`,
    );
  }

  /**
   * Run image processing job every 2 minutes
   */
  @Cron('*/2 * * * *') // Every 2 minutes
  async processImageQueue(): Promise<void> {
    if (!this.enabled || this.isProcessing) {
      return;
    }

    if (!this.backgroundRemovalService.isAvailable()) {
      this.logger.debug('Background removal service not available, skipping');
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();
    let processed = 0;

    try {
      // Get pending items
      const pendingItems = await this.wardrobeRepository.findPendingProcessing(
        this.batchSize,
      );

      if (pendingItems.length === 0) {
        this.logger.debug('No pending images to process');
        return;
      }

      this.logger.log(`Processing ${pendingItems.length} pending images`);

      for (const item of pendingItems) {
        try {
          await this.processItem(item);
          processed++;
        } catch (error) {
          const err = error as Error;
          this.logger.error(
            `Failed to process item ${item._id}: ${err.message}`,
          );
        }
      }

      this.lastRunAt = new Date();
      this.lastRunProcessed = processed;

      const duration = Date.now() - startTime;
      this.logger.log(
        `Image processing complete. Processed: ${processed}/${pendingItems.length} in ${duration}ms`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Image processing job failed: ${err.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single wardrobe item
   */
  private async processItem(item: any): Promise<void> {
    const itemId = item._id.toString();

    // Mark as processing
    await this.wardrobeRepository.updateImageProcessingStatus(
      itemId,
      ImageProcessingStatus.PROCESSING,
    );

    try {
      // Remove background
      const result = await this.backgroundRemovalService.removeBackgroundFromUrl(
        item.imageUrl,
        { quality: 'full', outputFormat: 'png' },
      );

      if (!result.success) {
        throw new Error(result.error || 'Background removal failed');
      }

      // Upload processed image to storage
      // Note: This would integrate with your storage service (GCS, S3, etc.)
      const processedUrl = await this.uploadProcessedImage(
        itemId,
        result.imageBuffer!,
        result.mimeType!,
      );

      // Generate thumbnail
      const thumbnailUrl = await this.generateThumbnail(
        itemId,
        result.imageBuffer!,
      );

      // Update item with processed URLs
      await this.wardrobeRepository.updateProcessedImages(itemId, {
        processedImageUrl: processedUrl,
        thumbnailUrl: thumbnailUrl,
        status: ImageProcessingStatus.COMPLETED,
      });

      this.logger.debug(`Successfully processed item ${itemId}`);
    } catch (error) {
      const err = error as Error;
      const retryCount = (item.imageProcessing?.retryCount || 0) + 1;

      if (retryCount >= this.maxRetries) {
        // Mark as failed after max retries
        await this.wardrobeRepository.updateImageProcessingStatus(
          itemId,
          ImageProcessingStatus.FAILED,
          err.message,
          retryCount,
        );
        this.logger.warn(
          `Item ${itemId} marked as failed after ${retryCount} attempts`,
        );
      } else {
        // Reset to pending for retry
        await this.wardrobeRepository.updateImageProcessingStatus(
          itemId,
          ImageProcessingStatus.PENDING,
          err.message,
          retryCount,
        );
        this.logger.debug(
          `Item ${itemId} will be retried. Attempt ${retryCount}/${this.maxRetries}`,
        );
      }

      throw error;
    }
  }

  /**
   * Upload processed image to storage
   * Note: This is a placeholder - integrate with your actual storage service
   */
  private async uploadProcessedImage(
    itemId: string,
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    // TODO: Integrate with GCS/S3 storage service
    // For now, return a placeholder URL
    // In production, this would upload to cloud storage and return the URL

    // Example GCS integration:
    // const bucket = this.storage.bucket('wardrobe-images');
    // const file = bucket.file(`processed/${itemId}.png`);
    // await file.save(imageBuffer, { contentType: mimeType });
    // return `https://storage.googleapis.com/wardrobe-images/processed/${itemId}.png`;

    this.logger.debug(
      `Would upload processed image for ${itemId} (${imageBuffer.length} bytes)`,
    );
    return `https://storage.example.com/processed/${itemId}.png`;
  }

  /**
   * Generate thumbnail from processed image
   * Note: This is a placeholder - integrate with your image processing library
   */
  private async generateThumbnail(
    itemId: string,
    imageBuffer: Buffer,
  ): Promise<string> {
    // TODO: Use sharp or similar to generate thumbnail
    // const thumbnail = await sharp(imageBuffer)
    //   .resize(200, 200, { fit: 'cover' })
    //   .toBuffer();

    this.logger.debug(`Would generate thumbnail for ${itemId}`);
    return `https://storage.example.com/thumbnails/${itemId}.png`;
  }

  /**
   * Manually trigger processing for a specific item
   */
  async processItemById(itemId: string): Promise<boolean> {
    try {
      const item = await this.wardrobeRepository.findById(itemId);

      if (!item) {
        throw new Error(`Item ${itemId} not found`);
      }

      await this.processItem(item);
      return true;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Manual processing failed for ${itemId}: ${err.message}`);
      return false;
    }
  }

  /**
   * Retry failed items
   */
  async retryFailedItems(limit: number = 50): Promise<number> {
    try {
      const failedItems = await this.wardrobeRepository.findFailedProcessing(limit);
      let retried = 0;

      for (const item of failedItems) {
        // Reset status to pending
        await this.wardrobeRepository.updateImageProcessingStatus(
          (item as any)._id.toString(),
          ImageProcessingStatus.PENDING,
          undefined,
          0, // Reset retry count
        );
        retried++;
      }

      this.logger.log(`Reset ${retried} failed items for retry`);
      return retried;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to retry items: ${err.message}`);
      return 0;
    }
  }

  /**
   * Get processing statistics
   */
  async getStats(): Promise<ProcessingStats> {
    const stats = await this.wardrobeRepository.getProcessingStats();

    return {
      ...stats,
      lastRunAt: this.lastRunAt,
      lastRunProcessed: this.lastRunProcessed,
    };
  }
}
