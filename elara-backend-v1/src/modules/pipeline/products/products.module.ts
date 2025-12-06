import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Product, ProductSchema } from './domain/schemas/product.schema';
import { ProductRepository } from './infrastructure/persistence/product.repository';

/**
 * Products Module
 *
 * Provides product persistence and search functionality:
 * - MongoDB persistence with deduplication
 * - Vector embeddings for semantic search
 * - Analytics tracking (views, clicks, saves)
 * - Trending/popular product queries
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Product.name, schema: ProductSchema },
    ]),
  ],
  providers: [ProductRepository],
  exports: [ProductRepository],
})
export class ProductsModule {}
