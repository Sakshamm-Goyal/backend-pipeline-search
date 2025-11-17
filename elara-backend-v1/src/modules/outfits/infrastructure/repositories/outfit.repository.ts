import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OutfitCombination } from '../../domain/schemas/outfit-combination.schema';

export interface OutfitQuery {
  userId: string | Types.ObjectId;
  isFavorite?: boolean;
  occasion?: string;
  season?: string;
}

@Injectable()
export class OutfitRepository {
  private readonly logger = new Logger(OutfitRepository.name);

  constructor(
    @InjectModel(OutfitCombination.name)
    private outfitModel: Model<OutfitCombination>,
  ) {}

  /**
   * Create a new outfit combination
   */
  async create(outfitData: Partial<OutfitCombination>): Promise<OutfitCombination> {
    try {
      const outfit = new this.outfitModel(outfitData);
      const saved = await outfit.save();
      this.logger.log(`OutfitCombination created: ${saved.id}`);
      return saved;
    } catch (error) {
      this.logger.error(`Failed to create OutfitCombination: ${error}`);
      throw error;
    }
  }

  /**
   * Find outfit by ID
   */
  async findById(id: string | Types.ObjectId): Promise<OutfitCombination | null> {
    try {
      const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
      return await this.outfitModel
        .findOne({ _id: objectId, isDeleted: false })
        .populate('items.wardrobeItemId')
        .exec();
    } catch (error) {
      this.logger.error(`Failed to find OutfitCombination: ${error}`);
      throw error;
    }
  }

  /**
   * Find all outfits for a user with optional filters
   */
  async findByUser(query: OutfitQuery): Promise<OutfitCombination[]> {
    try {
      const filter: any = {
        userId:
          typeof query.userId === 'string'
            ? new Types.ObjectId(query.userId)
            : query.userId,
        isDeleted: false,
      };

      if (query.isFavorite !== undefined) {
        filter.isFavorite = query.isFavorite;
      }

      if (query.occasion) {
        filter.occasion = query.occasion;
      }

      if (query.season) {
        filter.season = query.season;
      }

      return await this.outfitModel
        .find(filter)
        .populate('items.wardrobeItemId')
        .sort({ createdAt: -1 })
        .exec();
    } catch (error) {
      this.logger.error(`Failed to find outfit combinations: ${error}`);
      throw error;
    }
  }

  /**
   * Update an outfit
   */
  async update(
    id: string | Types.ObjectId,
    updateData: Partial<OutfitCombination>,
  ): Promise<OutfitCombination | null> {
    try {
      const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
      const updated = await this.outfitModel
        .findByIdAndUpdate(objectId, updateData, { new: true })
        .populate('items.wardrobeItemId')
        .exec();

      if (updated) {
        this.logger.log(`OutfitCombination updated: ${id}`);
      }

      return updated;
    } catch (error) {
      this.logger.error(`Failed to update OutfitCombination: ${error}`);
      throw error;
    }
  }

  /**
   * Soft delete an outfit
   */
  async softDelete(id: string | Types.ObjectId): Promise<boolean> {
    try {
      const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
      const result = await this.outfitModel
        .findByIdAndUpdate(objectId, {
          isDeleted: true,
          deletedAt: new Date(),
        })
        .exec();

      if (result) {
        this.logger.log(`OutfitCombination soft deleted: ${id}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Failed to soft delete OutfitCombination: ${error}`);
      throw error;
    }
  }

  /**
   * Permanently delete an outfit
   */
  async permanentDelete(id: string | Types.ObjectId): Promise<boolean> {
    try {
      const objectId = typeof id === 'string' ? new Types.ObjectId(id) : id;
      const result = await this.outfitModel.deleteOne({ _id: objectId }).exec();

      if (result.deletedCount > 0) {
        this.logger.log(`OutfitCombination permanently deleted: ${id}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(`Failed to permanently delete OutfitCombination: ${error}`);
      throw error;
    }
  }

  /**
   * Find outfits containing a specific wardrobe item
   */
  async findByWardrobeItem(
    wardrobeItemId: string | Types.ObjectId,
  ): Promise<OutfitCombination[]> {
    try {
      const objectId =
        typeof wardrobeItemId === 'string'
          ? new Types.ObjectId(wardrobeItemId)
          : wardrobeItemId;

      return await this.outfitModel
        .find({
          'items.wardrobeItemId': objectId,
          isDeleted: false,
        })
        .populate('items.wardrobeItemId')
        .exec();
    } catch (error) {
      this.logger.error(`Failed to find outfits by wardrobe item: ${error}`);
      throw error;
    }
  }

  /**
   * Count outfits by user
   */
  async countByUser(userId: string | Types.ObjectId): Promise<number> {
    try {
      const objectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;
      return await this.outfitModel
        .countDocuments({ userId: objectId, isDeleted: false })
        .exec();
    } catch (error) {
      this.logger.error(`Failed to count outfit combinations: ${error}`);
      throw error;
    }
  }
}
