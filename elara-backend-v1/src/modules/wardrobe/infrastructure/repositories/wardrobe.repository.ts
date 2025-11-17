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
  async findPendingProcessing(): Promise<WardrobeItem[]> {
    try {
      return await this.wardrobeItemModel
        .find({
          'imageProcessing.status': ImageProcessingStatus.PENDING,
          isDeleted: false,
        })
        .exec();
    } catch (error) {
      this.logger.error(`Failed to find pending items: ${error}`);
      throw error;
    }
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
}
