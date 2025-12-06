import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BackgroundRemovalService } from './background-removal.service';
import { ImageProcessorService } from './image-processor.service';
import { WardrobeEmbeddingProcessorService } from './wardrobe-embedding-processor.service';
import { WardrobeModule } from '../../wardrobe/wardrobe.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';

/**
 * Image Processing Module
 *
 * Provides image processing capabilities:
 * - Background removal (remove.bg, Replicate, local rembg)
 * - Thumbnail generation
 * - Image optimization
 * - Background job processing for wardrobe items
 * - Vector embedding generation for wardrobe items
 *
 * Integrates with:
 * - WardrobeModule for item updates
 * - EmbeddingsModule for vector generation
 * - Storage services for image upload
 *
 * Note: Requires ScheduleModule.forRoot() to be imported at app level for cron jobs.
 */
@Module({
  imports: [
    ConfigModule,
    WardrobeModule,
    EmbeddingsModule,
  ],
  providers: [
    BackgroundRemovalService,
    ImageProcessorService,
    WardrobeEmbeddingProcessorService,
  ],
  exports: [
    BackgroundRemovalService,
    ImageProcessorService,
    WardrobeEmbeddingProcessorService,
  ],
})
export class ImageProcessingModule {}
