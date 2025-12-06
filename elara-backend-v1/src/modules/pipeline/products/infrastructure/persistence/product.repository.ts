import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery, Types } from 'mongoose';
import {
  Product,
  ProductSource,
  ProductCategory,
  ProductEmbedding,
} from '../../domain/schemas/product.schema';
import { Product as ProductDTO } from '../../../search/dto/product.dto';

/**
 * Product Repository
 *
 * Handles all product persistence operations including:
 * - Batch upsert (save many with deduplication)
 * - Semantic search via vector similarity
 * - Filtering and pagination
 * - Analytics tracking (views, clicks, saves)
 */

export interface ProductFilter {
  categories?: ProductCategory[];
  brands?: string[];
  minPrice?: number;
  maxPrice?: number;
  onSale?: boolean;
  inStock?: boolean;
  tags?: string[];
  occasions?: string[];
  seasons?: string[];
  colors?: string[];
  sources?: ProductSource[];
}

export interface PaginatedProducts {
  products: Product[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SimilarProductResult {
  product: Product;
  similarity: number;
}

@Injectable()
export class ProductRepository {
  private readonly logger = new Logger(ProductRepository.name);

  constructor(
    @InjectModel(Product.name)
    private productModel: Model<Product>,
  ) {}

  /**
   * Save or update a single product (upsert)
   * Deduplicates based on source + sourceId
   */
  async save(productDto: ProductDTO): Promise<Product> {
    try {
      const productData = this.mapDtoToSchema(productDto);

      const product = await this.productModel.findOneAndUpdate(
        {
          source: productData.source,
          sourceId: productData.sourceId,
        },
        {
          $set: productData,
          $setOnInsert: { createdAt: new Date() },
        },
        {
          upsert: true,
          new: true,
        },
      );

      this.logger.debug(`Saved product ${product.externalId}`);
      return product;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error saving product: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Batch save products (bulk upsert with deduplication)
   * Efficiently handles large batches from search results
   */
  async saveMany(productDtos: ProductDTO[]): Promise<{ saved: number; updated: number }> {
    if (productDtos.length === 0) {
      return { saved: 0, updated: 0 };
    }

    try {
      const operations = productDtos.map((dto) => {
        const productData = this.mapDtoToSchema(dto);
        return {
          updateOne: {
            filter: {
              source: productData.source,
              sourceId: productData.sourceId,
            },
            update: {
              $set: productData,
              $setOnInsert: { createdAt: new Date() },
            },
            upsert: true,
          },
        };
      });

      const result = await this.productModel.bulkWrite(operations, {
        ordered: false, // Continue on error
      });

      this.logger.log(
        `Bulk saved ${result.upsertedCount} new, ${result.modifiedCount} updated products`,
      );

      return {
        saved: result.upsertedCount,
        updated: result.modifiedCount,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error bulk saving products: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Find product by ID
   */
  async findById(id: string): Promise<Product | null> {
    try {
      return await this.productModel.findOne({
        _id: new Types.ObjectId(id),
        isDeleted: false,
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error finding product: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Find product by external ID (source-sourceId)
   */
  async findByExternalId(externalId: string): Promise<Product | null> {
    try {
      return await this.productModel.findOne({
        externalId,
        isDeleted: false,
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error finding product by external ID: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Find products with filters and pagination
   */
  async findWithFilters(
    filters: ProductFilter,
    page: number = 1,
    limit: number = 20,
    sortBy: string = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc',
  ): Promise<PaginatedProducts> {
    try {
      const query = this.buildFilterQuery(filters);
      const skip = (page - 1) * limit;

      const sortOptions: any = {};
      sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

      const [products, total] = await Promise.all([
        this.productModel
          .find(query)
          .sort(sortOptions)
          .skip(skip)
          .limit(limit),
        this.productModel.countDocuments(query),
      ]);

      return {
        products,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error finding products: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Text search across title, description, brand
   */
  async textSearch(
    searchText: string,
    filters?: ProductFilter,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedProducts> {
    try {
      const baseQuery = this.buildFilterQuery(filters || {});
      const query = {
        ...baseQuery,
        $text: { $search: searchText },
      };

      const skip = (page - 1) * limit;

      const [products, total] = await Promise.all([
        this.productModel
          .find(query, { score: { $meta: 'textScore' } })
          .sort({ score: { $meta: 'textScore' } })
          .skip(skip)
          .limit(limit),
        this.productModel.countDocuments(query),
      ]);

      return {
        products,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error in text search: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Find similar products by vector embedding
   * NOTE: Requires MongoDB Atlas Vector Search or similar setup
   * Falls back to tag-based similarity for self-hosted
   */
  async findSimilarByVector(
    embedding: number[],
    limit: number = 10,
    excludeIds?: string[],
  ): Promise<SimilarProductResult[]> {
    try {
      // For MongoDB Atlas Vector Search (uncomment when available)
      /*
      const results = await this.productModel.aggregate([
        {
          $vectorSearch: {
            index: 'product_vector_index',
            path: 'embedding.vector',
            queryVector: embedding,
            numCandidates: limit * 10,
            limit: limit,
          },
        },
        {
          $match: {
            isDeleted: false,
            ...(excludeIds?.length ? { _id: { $nin: excludeIds.map(id => new Types.ObjectId(id)) } } : {}),
          },
        },
        {
          $addFields: {
            similarity: { $meta: 'vectorSearchScore' },
          },
        },
      ]);

      return results.map((doc) => ({
        product: doc as Product,
        similarity: doc.similarity,
      }));
      */

      // Fallback: Return empty for self-hosted without vector search
      this.logger.warn(
        'Vector search not available - requires MongoDB Atlas Vector Search',
      );
      return [];
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error in vector search: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Find similar products by attributes (fallback when vector search unavailable)
   */
  async findSimilarByAttributes(
    productId: string,
    limit: number = 10,
  ): Promise<Product[]> {
    try {
      const product = await this.findById(productId);
      if (!product) {
        return [];
      }

      // Build query based on product attributes
      const query: FilterQuery<Product> = {
        _id: { $ne: new Types.ObjectId(productId) },
        isDeleted: false,
      };

      // Same category
      if (product.category) {
        query.category = product.category;
      }

      // Similar price range (±30%)
      const priceMin = product.pricing.current * 0.7;
      const priceMax = product.pricing.current * 1.3;
      query['pricing.current'] = { $gte: priceMin, $lte: priceMax };

      // Similar style tags
      if (product.style?.tags?.length) {
        query['style.tags'] = { $in: product.style.tags };
      }

      return await this.productModel
        .find(query)
        .sort({ 'searchMeta.viewCount': -1 })
        .limit(limit);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error finding similar products: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Update product embedding
   */
  async updateEmbedding(
    productId: string,
    embedding: ProductEmbedding,
  ): Promise<boolean> {
    try {
      const result = await this.productModel.updateOne(
        { _id: new Types.ObjectId(productId) },
        { $set: { embedding } },
      );

      return result.modifiedCount > 0;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error updating embedding: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Batch update embeddings
   */
  async updateManyEmbeddings(
    updates: Array<{ productId: string; embedding: ProductEmbedding }>,
  ): Promise<number> {
    if (updates.length === 0) return 0;

    try {
      const operations = updates.map(({ productId, embedding }) => ({
        updateOne: {
          filter: { _id: new Types.ObjectId(productId) },
          update: { $set: { embedding } },
        },
      }));

      const result = await this.productModel.bulkWrite(operations);
      this.logger.log(`Updated ${result.modifiedCount} embeddings`);
      return result.modifiedCount;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error batch updating embeddings: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Find products without embeddings (for background processing)
   */
  async findWithoutEmbeddings(limit: number = 100): Promise<Product[]> {
    try {
      return await this.productModel
        .find({
          isDeleted: false,
          $or: [
            { 'embedding.vector': { $exists: false } },
            { 'embedding.vector': { $size: 0 } },
          ],
        })
        .sort({ createdAt: -1 })
        .limit(limit);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error finding products without embeddings: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Increment view count
   */
  async incrementViewCount(productId: string): Promise<void> {
    try {
      await this.productModel.updateOne(
        { _id: new Types.ObjectId(productId) },
        {
          $inc: { 'searchMeta.viewCount': 1 },
          $set: { 'searchMeta.lastSearchedAt': new Date() },
        },
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error incrementing view count: ${err.message}`, err.stack);
    }
  }

  /**
   * Increment click count (user clicked product link)
   */
  async incrementClickCount(productId: string): Promise<void> {
    try {
      await this.productModel.updateOne(
        { _id: new Types.ObjectId(productId) },
        { $inc: { 'searchMeta.clickCount': 1 } },
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error incrementing click count: ${err.message}`, err.stack);
    }
  }

  /**
   * Increment save count (user added to wishlist)
   */
  async incrementSaveCount(productId: string): Promise<void> {
    try {
      await this.productModel.updateOne(
        { _id: new Types.ObjectId(productId) },
        { $inc: { 'searchMeta.saveCount': 1 } },
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error incrementing save count: ${err.message}`, err.stack);
    }
  }

  /**
   * Decrement save count (user removed from wishlist)
   */
  async decrementSaveCount(productId: string): Promise<void> {
    try {
      await this.productModel.updateOne(
        { _id: new Types.ObjectId(productId) },
        { $inc: { 'searchMeta.saveCount': -1 } },
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error decrementing save count: ${err.message}`, err.stack);
    }
  }

  /**
   * Get trending products (most views in recent period)
   */
  async getTrending(
    period: 'day' | 'week' | 'month' = 'week',
    limit: number = 20,
    category?: ProductCategory,
  ): Promise<Product[]> {
    try {
      const cutoffDate = new Date();
      switch (period) {
        case 'day':
          cutoffDate.setDate(cutoffDate.getDate() - 1);
          break;
        case 'week':
          cutoffDate.setDate(cutoffDate.getDate() - 7);
          break;
        case 'month':
          cutoffDate.setMonth(cutoffDate.getMonth() - 1);
          break;
      }

      const query: FilterQuery<Product> = {
        isDeleted: false,
        'searchMeta.lastSearchedAt': { $gte: cutoffDate },
      };

      if (category) {
        query.category = category;
      }

      return await this.productModel
        .find(query)
        .sort({ 'searchMeta.viewCount': -1 })
        .limit(limit);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting trending products: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Mark product as stale (for cleanup)
   */
  async markAsStale(productId: string): Promise<void> {
    try {
      await this.productModel.updateOne(
        { _id: new Types.ObjectId(productId) },
        { $set: { isStale: true } },
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error marking product as stale: ${err.message}`, err.stack);
    }
  }

  /**
   * Soft delete product
   */
  async delete(productId: string): Promise<boolean> {
    try {
      const result = await this.productModel.updateOne(
        { _id: new Types.ObjectId(productId) },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
          },
        },
      );
      return result.modifiedCount > 0;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error deleting product: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get product statistics
   */
  async getStats(): Promise<{
    total: number;
    bySource: Record<string, number>;
    byCategory: Record<string, number>;
    withEmbeddings: number;
    stale: number;
  }> {
    try {
      const [total, bySource, byCategory, withEmbeddings, stale] =
        await Promise.all([
          this.productModel.countDocuments({ isDeleted: false }),
          this.productModel.aggregate([
            { $match: { isDeleted: false } },
            { $group: { _id: '$source', count: { $sum: 1 } } },
          ]),
          this.productModel.aggregate([
            { $match: { isDeleted: false } },
            { $group: { _id: '$category', count: { $sum: 1 } } },
          ]),
          this.productModel.countDocuments({
            isDeleted: false,
            'embedding.vector': { $exists: true, $not: { $size: 0 } },
          }),
          this.productModel.countDocuments({ isStale: true }),
        ]);

      return {
        total,
        bySource: bySource.reduce(
          (acc, item) => ({ ...acc, [item._id || 'unknown']: item.count }),
          {},
        ),
        byCategory: byCategory.reduce(
          (acc, item) => ({ ...acc, [item._id || 'unknown']: item.count }),
          {},
        ),
        withEmbeddings,
        stale,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting stats: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Build MongoDB filter query from ProductFilter
   */
  private buildFilterQuery(filters: ProductFilter): FilterQuery<Product> {
    const query: FilterQuery<Product> = { isDeleted: false };

    if (filters.categories?.length) {
      query.category = { $in: filters.categories };
    }

    if (filters.brands?.length) {
      query.brand = { $in: filters.brands.map((b) => new RegExp(b, 'i')) };
    }

    if (filters.minPrice !== undefined) {
      query['pricing.current'] = { ...query['pricing.current'], $gte: filters.minPrice };
    }

    if (filters.maxPrice !== undefined) {
      query['pricing.current'] = { ...query['pricing.current'], $lte: filters.maxPrice };
    }

    if (filters.onSale !== undefined) {
      query['pricing.onSale'] = filters.onSale;
    }

    if (filters.inStock !== undefined) {
      query['availability.inStock'] = filters.inStock;
    }

    if (filters.tags?.length) {
      query['style.tags'] = { $in: filters.tags };
    }

    if (filters.occasions?.length) {
      query['style.occasions'] = { $in: filters.occasions };
    }

    if (filters.seasons?.length) {
      query['style.seasons'] = { $in: filters.seasons };
    }

    if (filters.colors?.length) {
      query.color = { $in: filters.colors.map((c) => new RegExp(c, 'i')) };
    }

    if (filters.sources?.length) {
      query.source = { $in: filters.sources };
    }

    return query;
  }

  /**
   * Map ProductDTO to Product schema
   */
  private mapDtoToSchema(dto: ProductDTO): Partial<Product> {
    const sourceMap: Record<string, ProductSource> = {
      oxylabs: ProductSource.OXYLABS,
      shopstyle: ProductSource.SHOPSTYLE,
      asos_scraper: ProductSource.ASOS_SCRAPER,
      zara_scraper: ProductSource.ZARA_SCRAPER,
      hm_scraper: ProductSource.HM_SCRAPER,
      cache: ProductSource.CACHE,
    };

    const categoryMap: Record<string, ProductCategory> = {
      dress: ProductCategory.DRESS,
      top: ProductCategory.TOP,
      bottom: ProductCategory.BOTTOM,
      outerwear: ProductCategory.OUTERWEAR,
      shoes: ProductCategory.SHOES,
      bags: ProductCategory.BAGS,
      accessories: ProductCategory.ACCESSORIES,
      jewelry: ProductCategory.JEWELRY,
      swimwear: ProductCategory.SWIMWEAR,
      activewear: ProductCategory.ACTIVEWEAR,
      loungewear: ProductCategory.LOUNGEWEAR,
    };

    const source = sourceMap[dto.source] || ProductSource.OXYLABS;

    return {
      externalId: dto.id,
      sourceId: dto.sourceId,
      source,
      title: dto.title,
      description: dto.description,
      brand: dto.brand,
      retailer: dto.retailer,
      category: dto.category ? categoryMap[dto.category.toLowerCase()] : undefined,
      color: dto.color,
      pricing: {
        current: dto.price,
        original: dto.originalPrice,
        currency: dto.currency || 'USD',
        onSale: dto.onSale,
        discountPercent: dto.discount,
        priceUpdatedAt: new Date(),
      },
      images: {
        primary: dto.imageUrl,
        gallery: dto.images || [],
        thumbnail: dto.thumbnail,
      },
      productUrl: dto.productUrl,
      affiliateUrl: dto.affiliateUrl,
      rating: dto.rating
        ? {
            average: dto.rating,
            count: dto.reviewCount,
            updatedAt: new Date(),
          }
        : undefined,
      availability: {
        inStock: dto.inStock,
        stockLevel: dto.stockLevel,
        sizes: dto.sizes || [],
        colors: dto.colors || [],
        checkedAt: new Date(),
      },
      style: {
        tags: dto.tags || [],
        pattern: dto.pattern,
        material: dto.material,
        sustainable: dto.sustainable,
        occasions: [],
        seasons: [],
      },
      searchMeta: {
        relevanceScore: dto.score,
        viewCount: 0,
        clickCount: 0,
        saveCount: 0,
        purchaseCount: 0,
      },
      scrapedAt: dto.scrapedAt,
      lastVerifiedAt: new Date(),
      isStale: false,
      isDeleted: false,
    };
  }
}
