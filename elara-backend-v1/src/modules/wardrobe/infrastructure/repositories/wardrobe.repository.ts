import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WardrobeItem } from '../../domain/schemas/wardrobe-item.schema';
import { WardrobeCategory } from '../../domain/enums/wardrobe-category.enum';
import { ImageProcessingStatus } from '../../domain/enums/image-processing-status.enum';

export interface WardrobeQuery {
  userId: string | Types.ObjectId;
  category?: WardrobeCategory;
  isFavorite?: boolean;
  brand?: string;
  tags?: string[];
}

@Injectable()
export class WardrobeRepository {
  private readonly logger = new Logger(WardrobeRepository.name);

  constructor(
    @InjectModel(WardrobeItem.name)
    private wardrobeItemModel: Model<WardrobeItem>,
  ) {}

  /**
   * Create a new wardrobe item
   */
  async create(itemData: Partial<WardrobeItem>): Promise<WardrobeItem> {
    try {
      const item = new this.wardrobeItemModel(itemData);
      const saved = await item.save();
      this.logger.log(`WardrobeItem created: ${saved.id}`);
      return saved;
    } catch (error) {
      this.logger.error(`Failed to create WardrobeItem: ${error}`);
      throw error;
    }
  }

  /**
   * Find item by ID
   */
  async findById(id: string | Types.ObjectId): Promise<WardrobeItem | null> {
    try {
      const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
      return await this.wardrobeItemModel
        .findOne({ _id: objectId, isDeleted: false })
        .exec();
    } catch (error) {
      this.logger.error(`Failed to find WardrobeItem: ${error}`);
      throw error;
    }
  }

  /**
   * Find item by ID including deleted items
   */
  async findByIdIncludingDeleted(id: string | Types.ObjectId): Promise<WardrobeItem | null> {
    try {
      const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
      return await this.wardrobeItemModel
        .findOne({ _id: objectId })
        .exec();
    } catch (error) {
      this.logger.error(`Failed to find WardrobeItem (including deleted): ${error}`);
      throw error;
    }
  }

  /**
   * Find all items for a user with optional filters
   */
  async findByUser(query: WardrobeQuery): Promise<WardrobeItem[]> {
    try {
      const filter: any = {
        userId:
          typeof query.userId === 'string'
            ? new Types.ObjectId(query.userId)
            : query.userId,
        isDeleted: false,
      };

      if (query.category) {
        filter.category = query.category;
      }

      if (query.isFavorite !== undefined) {
        filter.isFavorite = query.isFavorite;
      }

      if (query.brand) {
        filter.brand = query.brand;
      }

      if (query.tags && query.tags.length > 0) {
        filter.userTags = { $in: query.tags };
      }

      return await this.wardrobeItemModel.find(filter).sort({ createdAt: -1 }).exec();
    } catch (error) {
      this.logger.error(`Failed to find wardrobe items: ${error}`);
      throw error;
    }
  }

  /**
   * Update an item
   */
  async update(
    id: string | Types.ObjectId,
    updateData: Partial<WardrobeItem>,
  ): Promise<WardrobeItem | null> {
    try {
      const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
      const updated = await this.wardrobeItemModel
        .findByIdAndUpdate(objectId, updateData, { new: true })
        .exec();

      if (updated) {
        this.logger.log(`WardrobeItem updated: ${id}`);
      }

      return updated;
    } catch (error) {
      this.logger.error(`Failed to update WardrobeItem: ${error}`);
      throw error;
    }
  }

  /**
   * Soft delete an item
   */
  async softDelete(id: string | Types.ObjectId): Promise<boolean> {
    try {
      const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
      const result = await this.wardrobeItemModel
        .findByIdAndUpdate(objectId, {
          isDeleted: true,
          deletedAt: new Date(),
        })
        .exec();

      if (result) {
        this.logger.log(`WardrobeItem soft deleted: ${id}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Failed to soft delete WardrobeItem: ${error}`);
      throw error;
    }
  }

  /**
   * Restore a soft-deleted item
   */
  async restore(id: string | Types.ObjectId): Promise<boolean> {
    try {
      const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
      const result = await this.wardrobeItemModel
        .findByIdAndUpdate(objectId, {
          isDeleted: false,
          deletedAt: null,
        })
        .exec();

      if (result) {
        this.logger.log(`WardrobeItem restored: ${id}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Failed to restore WardrobeItem: ${error}`);
      throw error;
    }
  }

  /**
   * Permanently delete an item
   */
  async permanentDelete(id: string | Types.ObjectId): Promise<boolean> {
    try {
      const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
      const result = await this.wardrobeItemModel.deleteOne({ _id: objectId }).exec();

      if (result.deletedCount > 0) {
        this.logger.log(`WardrobeItem permanently deleted: ${id}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Failed to permanently delete WardrobeItem: ${error}`);
      throw error;
    }
  }

  /**
   * Find items with pending image processing
   */
  async findPendingProcessing(limit: number = 50): Promise<WardrobeItem[]> {
    try {
      return await this.wardrobeItemModel
        .find({
          'imageProcessing.status': ImageProcessingStatus.PENDING,
          isDeleted: false,
        })
        .sort({ createdAt: 1 }) // Process oldest first
        .limit(limit)
        .exec();
    } catch (error) {
      this.logger.error(`Failed to find pending items: ${error}`);
      throw error;
    }
  }

  /**
   * Find items with failed image processing
   */
  async findFailedProcessing(limit: number = 50): Promise<WardrobeItem[]> {
    try {
      return await this.wardrobeItemModel
        .find({
          'imageProcessing.status': ImageProcessingStatus.FAILED,
          isDeleted: false,
        })
        .sort({ updatedAt: 1 })
        .limit(limit)
        .exec();
    } catch (error) {
      this.logger.error(`Failed to find failed items: ${error}`);
      throw error;
    }
  }

  /**
   * Update image processing status
   */
  async updateImageProcessingStatus(
    id: string,
    status: ImageProcessingStatus,
    error?: string,
    retryCount?: number,
  ): Promise<WardrobeItem | null> {
    try {
      const updateData: any = {
        'imageProcessing.status': status,
      };

      if (error !== undefined) {
        updateData['imageProcessing.error'] = error;
      }

      if (retryCount !== undefined) {
        updateData['imageProcessing.retryCount'] = retryCount;
      }

      if (status === ImageProcessingStatus.COMPLETED) {
        updateData['imageProcessing.processedAt'] = new Date();
      }

      return await this.wardrobeItemModel
        .findByIdAndUpdate(id, { $set: updateData }, { new: true })
        .exec();
    } catch (error) {
      this.logger.error(`Failed to update processing status: ${error}`);
      throw error;
    }
  }

  /**
   * Update processed image URLs
   */
  async updateProcessedImages(
    id: string,
    data: {
      processedImageUrl?: string;
      processedImageKey?: string;
      thumbnailUrl?: string;
      thumbnailKey?: string;
      status: ImageProcessingStatus;
    },
  ): Promise<WardrobeItem | null> {
    try {
      const updateData: any = {
        'imageProcessing.status': data.status,
        'imageProcessing.processedAt': new Date(),
      };

      if (data.processedImageUrl) {
        updateData.processedImageUrl = data.processedImageUrl;
        updateData['imageProcessing.backgroundRemoved'] = true;
      }

      if (data.processedImageKey) {
        updateData.processedImageKey = data.processedImageKey;
      }

      if (data.thumbnailUrl) {
        updateData.thumbnailUrl = data.thumbnailUrl;
        updateData['imageProcessing.thumbnailGenerated'] = true;
      }

      if (data.thumbnailKey) {
        updateData.thumbnailKey = data.thumbnailKey;
      }

      return await this.wardrobeItemModel
        .findByIdAndUpdate(id, { $set: updateData }, { new: true })
        .exec();
    } catch (error) {
      this.logger.error(`Failed to update processed images: ${error}`);
      throw error;
    }
  }

  /**
   * Get image processing statistics
   */
  async getProcessingStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  }> {
    try {
      const [pending, processing, completed, failed] = await Promise.all([
        this.wardrobeItemModel.countDocuments({
          'imageProcessing.status': ImageProcessingStatus.PENDING,
          isDeleted: false,
        }),
        this.wardrobeItemModel.countDocuments({
          'imageProcessing.status': ImageProcessingStatus.PROCESSING,
          isDeleted: false,
        }),
        this.wardrobeItemModel.countDocuments({
          'imageProcessing.status': ImageProcessingStatus.COMPLETED,
          isDeleted: false,
        }),
        this.wardrobeItemModel.countDocuments({
          'imageProcessing.status': ImageProcessingStatus.FAILED,
          isDeleted: false,
        }),
      ]);

      return { pending, processing, completed, failed };
    } catch (error) {
      this.logger.error(`Failed to get processing stats: ${error}`);
      throw error;
    }
  }

  /**
   * Find items without embeddings (for background embedding generation)
   */
  async findWithoutEmbeddings(limit: number = 50): Promise<WardrobeItem[]> {
    try {
      return await this.wardrobeItemModel
        .find({
          isDeleted: false,
          $or: [
            { embedding: { $exists: false } },
            { 'embedding.vector': { $size: 0 } },
            { 'embedding.vector': { $exists: false } },
          ],
        })
        .sort({ createdAt: 1 })
        .limit(limit)
        .exec();
    } catch (error) {
      this.logger.error(`Failed to find items without embeddings: ${error}`);
      throw error;
    }
  }

  /**
   * Update embedding for a wardrobe item
   */
  async updateEmbedding(
    id: string,
    embedding: {
      vector: number[];
      model: string;
      inputText?: string;
    },
  ): Promise<WardrobeItem | null> {
    try {
      return await this.wardrobeItemModel
        .findByIdAndUpdate(
          id,
          {
            $set: {
              'embedding.vector': embedding.vector,
              'embedding.model': embedding.model,
              'embedding.generatedAt': new Date(),
              'embedding.inputText': embedding.inputText?.substring(0, 200),
            },
          },
          { new: true },
        )
        .exec();
    } catch (error) {
      this.logger.error(`Failed to update embedding: ${error}`);
      throw error;
    }
  }

  /**
   * Find similar items by vector embedding
   */
  async findSimilarByVector(
    vector: number[],
    limit: number = 10,
    excludeIds: string[] = [],
  ): Promise<Array<{ item: WardrobeItem; similarity: number }>> {
    // Note: For production, use MongoDB Atlas Vector Search or a dedicated vector DB
    // This is a basic implementation for development
    try {
      const items = await this.wardrobeItemModel
        .find({
          isDeleted: false,
          'embedding.vector': { $exists: true, $ne: [] },
          ...(excludeIds.length > 0 && {
            _id: { $nin: excludeIds.map((id) => new Types.ObjectId(id)) },
          }),
        })
        .exec();

      // Calculate cosine similarity
      const withSimilarity = items
        .map((item) => ({
          item,
          similarity: this.cosineSimilarity(vector, item.embedding?.vector || []),
        }))
        .filter((r) => r.similarity > 0)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      return withSimilarity;
    } catch (error) {
      this.logger.error(`Failed to find similar items: ${error}`);
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Count items by user
   */
  async countByUser(userId: string | Types.ObjectId): Promise<number> {
    try {
      const objectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
      return await this.wardrobeItemModel
        .countDocuments({ userId: objectId, isDeleted: false })
        .exec();
    } catch (error) {
      this.logger.error(`Failed to count wardrobe items: ${error}`);
      throw error;
    }
  }

  /**
   * Get embedding statistics
   */
  async getEmbeddingStats(): Promise<{
    totalItems: number;
    withEmbeddings: number;
    withoutEmbeddings: number;
    percentComplete: number;
  }> {
    try {
      const [totalItems, withEmbeddings] = await Promise.all([
        this.wardrobeItemModel.countDocuments({ isDeleted: false }),
        this.wardrobeItemModel.countDocuments({
          isDeleted: false,
          'embedding.vector': { $exists: true, $ne: [] },
        }),
      ]);

      const withoutEmbeddings = totalItems - withEmbeddings;
      const percentComplete = totalItems > 0
        ? Math.round((withEmbeddings / totalItems) * 100)
        : 0;

      return {
        totalItems,
        withEmbeddings,
        withoutEmbeddings,
        percentComplete,
      };
    } catch (error) {
      this.logger.error(`Failed to get embedding stats: ${error}`);
      throw error;
    }
  }
}
