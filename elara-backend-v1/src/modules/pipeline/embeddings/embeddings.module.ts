import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmbeddingService } from './embedding.service';
import { EmbeddingProcessorService } from './embedding-processor.service';
import { ProductsModule } from '../products/products.module';

/**
 * Embeddings Module
 *
 * Provides vector embedding generation for semantic search and similarity.
 * Uses OpenAI text-embedding-3-small (1536 dimensions).
 *
 * Features:
 * - Single and batch embedding generation
 * - Product and wardrobe item text formatting
 * - Cosine similarity calculation
 * - Rate limiting and cost tracking
 * - Background processor for unembedded products
 */
@Module({
  imports: [ConfigModule, forwardRef(() => ProductsModule)],
  providers: [EmbeddingService, EmbeddingProcessorService],
  exports: [EmbeddingService, EmbeddingProcessorService],
})
export class EmbeddingsModule {}
