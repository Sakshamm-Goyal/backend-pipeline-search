/// <reference types="multer" />
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { WardrobeRepository, WardrobeQuery } from '../../infrastructure/repositories/wardrobe.repository';
import { StorageService } from '../../../shared/services/storage.service';
import { ImageProcessingService } from '../../../shared/services/image-processing.service';
import { CreateWardrobeItemDto } from '../dtos/create-wardrobe-item.dto';
import { UpdateWardrobeItemDto } from '../dtos/update-wardrobe-item.dto';
import { QueryWardrobeDto } from '../dtos/query-wardrobe.dto';
import { ImageProcessingStatus } from '../../domain/enums/image-processing-status.enum';

@Injectable()
export class WardrobeService {
  private readonly logger = new Logger(WardrobeService.name);

  constructor(
    private wardrobeRepository: WardrobeRepository,
    private storageService: StorageService,
    private imageProcessingService: ImageProcessingService,
  ) {}

  /**
   * Create a new wardrobe item with image upload
   */
  async createItem(
    userId: string,
    file: Express.Multer.File,
    dto: CreateWardrobeItemDto,
  ) {
    try {
      // Validate image
      const isValid = await this.imageProcessingService.isValidImage(file.buffer);
      if (!isValid) {
        throw new BadRequestException('Invalid image file');
      }

      // Process image (resize, thumbnail)
      const processed = await this.imageProcessingService.processImage(file.buffer);

      // Upload original/resized image to GCS
      const imagePath = this.storageService.generateFilePath(
        userId,
        'wardrobe/images',
        file.originalname,
      );

      const { url: imageUrl, key: imageKey } =
        await this.storageService.uploadBuffer(
          processed.resized || processed.original,
          imagePath,
          file.mimetype,
        );

      // Upload thumbnail
      const thumbnailPath = this.storageService.generateFilePath(
        userId,
        'wardrobe/thumbnails',
        `thumb-${file.originalname}`,
      );

      const { url: thumbnailUrl, key: thumbnailKey } =
        await this.storageService.uploadBuffer(
          processed.thumbnail!,
          thumbnailPath,
          'image/jpeg',
        );

      // Extract dominant color
      const dominantColor = await this.imageProcessingService.extractDominantColor(
        processed.original,
      );

      // Create wardrobe item
      const item = await this.wardrobeRepository.create({
        userId: new Types.ObjectId(userId),
        category: dto.category,
        subcategory: dto.subcategory,
        name: dto.name,
        description: dto.description,
        imageUrl,
        imageKey,
        thumbnailUrl,
        thumbnailKey,
        aiAnalysis: {
          dominantColor,
          colorPalette: [dominantColor],
          style: [],
          occasion: [],
          season: [],
        },
        imageProcessing: {
          status: ImageProcessingStatus.COMPLETED,
          backgroundRemoved: false,
          thumbnailGenerated: true,
          retryCount: 0,
          processedAt: new Date(),
        },
        userTags: dto.userTags || [],
        brand: dto.brand,
        purchaseDate: dto.purchaseDate ? new Date(dto.purchaseDate) : undefined,
        price: dto.price,
        currency: dto.currency,
        notes: dto.notes,
        isFavorite: dto.isFavorite || false,
        timesWorn: 0,
        outfitIds: [],
        isDeleted: false,
      });

      this.logger.log(`Wardrobe item created: ${item.id} for userId: ${userId}`);

      return item;
    } catch (error) {
      this.logger.error(`Failed to create wardrobe item: ${error}`);
      throw error;
    }
  }

  /**
   * Get all wardrobe items for a user with optional filters
   */
  async getUserItems(userId: string, query: QueryWardrobeDto) {
    try {
      const wardrobeQuery: WardrobeQuery = {
        userId,
        category: query.category,
        isFavorite: query.isFavorite,
        brand: query.brand,
        tags: query.tags,
      };

      const items = await this.wardrobeRepository.findByUser(wardrobeQuery);

      return {
        items,
        count: items.length,
      };
    } catch (error) {
      this.logger.error(`Failed to get wardrobe items: ${error}`);
      throw error;
    }
  }

  /**
   * Get a single wardrobe item by ID
   */
  async getItemById(userId: string, itemId: string) {
    try {
      const item = await this.wardrobeRepository.findById(itemId);

      if (!item) {
        throw new NotFoundException('Wardrobe item not found');
      }

      // Verify ownership
      if (item.userId.toString() !== userId) {
        throw new ForbiddenException('You do not have access to this item');
      }

      return item;
    } catch (error) {
      this.logger.error(`Failed to get wardrobe item: ${error}`);
      throw error;
    }
  }

  /**
   * Update a wardrobe item
   */
  async updateItem(userId: string, itemId: string, dto: UpdateWardrobeItemDto) {
    try {
      const item = await this.wardrobeRepository.findById(itemId);

      if (!item) {
        throw new NotFoundException('Wardrobe item not found');
      }

      // Verify ownership
      if (item.userId.toString() !== userId) {
        throw new ForbiddenException('You do not have access to this item');
      }

      const updateData: any = {
        ...dto,
      };

      if (dto.purchaseDate) {
        updateData.purchaseDate = new Date(dto.purchaseDate);
      }

      const updated = await this.wardrobeRepository.update(itemId, updateData);

      this.logger.log(`Wardrobe item updated: ${itemId}`);

      return updated;
    } catch (error) {
      this.logger.error(`Failed to update wardrobe item: ${error}`);
      throw error;
    }
  }

  /**
   * Update wardrobe item image
   */
  async updateItemImage(
    userId: string,
    itemId: string,
    file: Express.Multer.File,
  ) {
    try {
      const item = await this.wardrobeRepository.findById(itemId);

      if (!item) {
        throw new NotFoundException('Wardrobe item not found');
      }

      // Verify ownership
      if (item.userId.toString() !== userId) {
        throw new ForbiddenException('You do not have access to this item');
      }

      // Validate new image
      const isValid = await this.imageProcessingService.isValidImage(file.buffer);
      if (!isValid) {
        throw new BadRequestException('Invalid image file');
      }

      // Delete old images from cloud storage
      if (item.imageKey) {
        await this.storageService.deleteFile(item.imageKey);
      }
      if (item.thumbnailKey) {
        await this.storageService.deleteFile(item.thumbnailKey);
      }

      // Process new image
      const processed = await this.imageProcessingService.processImage(file.buffer);

      // Upload new image
      const imagePath = this.storageService.generateFilePath(
        userId,
        'wardrobe/images',
        file.originalname,
      );

      const { url: imageUrl, key: imageKey } =
        await this.storageService.uploadBuffer(
          processed.resized || processed.original,
          imagePath,
          file.mimetype,
        );

      // Upload new thumbnail
      const thumbnailPath = this.storageService.generateFilePath(
        userId,
        'wardrobe/thumbnails',
        `thumb-${file.originalname}`,
      );

      const { url: thumbnailUrl, key: thumbnailKey } =
        await this.storageService.uploadBuffer(
          processed.thumbnail!,
          thumbnailPath,
          'image/jpeg',
        );

      // Extract new dominant color
      const dominantColor = await this.imageProcessingService.extractDominantColor(
        processed.original,
      );

      // Update item with new image data
      const updateData: any = {
        imageUrl,
        imageKey,
        thumbnailUrl,
        thumbnailKey,
        aiAnalysis: {
          ...item.aiAnalysis,
          dominantColor,
          colorPalette: [dominantColor],
        },
        imageProcessing: {
          status: ImageProcessingStatus.COMPLETED,
          backgroundRemoved: false,
          thumbnailGenerated: true,
          retryCount: 0,
          processedAt: new Date(),
        },
      };

      const updated = await this.wardrobeRepository.update(itemId, updateData);

      this.logger.log(`Wardrobe item image updated: ${itemId}`);

      return updated;
    } catch (error) {
      this.logger.error(`Failed to update wardrobe item image: ${error}`);
      throw error;
    }
  }

  /**
   * Delete a wardrobe item (soft delete)
   */
  async deleteItem(userId: string, itemId: string) {
    try {
      const item = await this.wardrobeRepository.findById(itemId);

      if (!item) {
        throw new NotFoundException('Wardrobe item not found');
      }

      // Verify ownership
      if (item.userId.toString() !== userId) {
        throw new ForbiddenException('You do not have access to this item');
      }

      await this.wardrobeRepository.softDelete(itemId);

      this.logger.log(`Wardrobe item deleted: ${itemId}`);

      return { message: 'Item deleted successfully' };
    } catch (error) {
      this.logger.error(`Failed to delete wardrobe item: ${error}`);
      throw error;
    }
  }

  /**
   * Restore a soft-deleted wardrobe item
   */
  async restoreItem(userId: string, itemId: string) {
    try {
      const item = await this.wardrobeRepository.findByIdIncludingDeleted(itemId);

      if (!item) {
        throw new NotFoundException('Wardrobe item not found');
      }

      // Verify ownership
      if (item.userId.toString() !== userId) {
        throw new ForbiddenException('You do not have access to this item');
      }

      // Check if item is actually deleted
      if (!item.isDeleted) {
        throw new BadRequestException('Item is not deleted');
      }

      await this.wardrobeRepository.restore(itemId);

      this.logger.log(`Wardrobe item restored: ${itemId}`);

      return { message: 'Item restored successfully' };
    } catch (error) {
      this.logger.error(`Failed to restore wardrobe item: ${error}`);
      throw error;
    }
  }

  /**
   * Permanently delete a wardrobe item and its images
   */
  async permanentDeleteItem(userId: string, itemId: string) {
    try {
      const item = await this.wardrobeRepository.findByIdIncludingDeleted(itemId);

      if (!item) {
        throw new NotFoundException('Wardrobe item not found');
      }

      // Verify ownership
      if (item.userId.toString() !== userId) {
        throw new ForbiddenException('You do not have access to this item');
      }

      // Delete images from GCS
      if (item.imageKey) {
        await this.storageService.deleteFile(item.imageKey);
      }

      if (item.thumbnailKey) {
        await this.storageService.deleteFile(item.thumbnailKey);
      }

      if (item.processedImageKey) {
        await this.storageService.deleteFile(item.processedImageKey);
      }

      // Permanently delete from database
      await this.wardrobeRepository.permanentDelete(itemId);

      this.logger.log(`Wardrobe item permanently deleted: ${itemId}`);

      return { message: 'Item permanently deleted successfully' };
    } catch (error) {
      this.logger.error(`Failed to permanently delete wardrobe item: ${error}`);
      throw error;
    }
  }

  /**
   * Toggle favorite status
   */
  async toggleFavorite(userId: string, itemId: string) {
    try {
      const item = await this.wardrobeRepository.findById(itemId);

      if (!item) {
        throw new NotFoundException('Wardrobe item not found');
      }

      // Verify ownership
      if (item.userId.toString() !== userId) {
        throw new ForbiddenException('You do not have access to this item');
      }

      const updated = await this.wardrobeRepository.update(itemId, {
        isFavorite: !item.isFavorite,
      });

      this.logger.log(`Wardrobe item favorite toggled: ${itemId}`);

      return updated;
    } catch (error) {
      this.logger.error(`Failed to toggle favorite: ${error}`);
      throw error;
    }
  }

  /**
   * Increment times worn
   */
  async incrementTimesWorn(userId: string, itemId: string) {
    try {
      const item = await this.wardrobeRepository.findById(itemId);

      if (!item) {
        throw new NotFoundException('Wardrobe item not found');
      }

      // Verify ownership
      if (item.userId.toString() !== userId) {
        throw new ForbiddenException('You do not have access to this item');
      }

      const updated = await this.wardrobeRepository.update(itemId, {
        timesWorn: item.timesWorn + 1,
        lastWornAt: new Date(),
      });

      this.logger.log(`Wardrobe item times worn incremented: ${itemId}`);

      return updated;
    } catch (error) {
      this.logger.error(`Failed to increment times worn: ${error}`);
      throw error;
    }
  }

  /**
   * Get wardrobe stats for a user
   */
  async getUserStats(userId: string) {
    try {
      const allItems = await this.wardrobeRepository.findByUser({ userId });

      const stats = {
        totalItems: allItems.length,
        favorites: allItems.filter((item) => item.isFavorite).length,
        byCategory: {} as Record<string, number>,
        mostWorn: allItems
          .sort((a, b) => b.timesWorn - a.timesWorn)
          .slice(0, 10)
          .map((item) => ({
            id: item.id,
            name: item.name,
            category: item.category,
            timesWorn: item.timesWorn,
            thumbnailUrl: item.thumbnailUrl,
          })),
      };

      // Count by category
      allItems.forEach((item) => {
        stats.byCategory[item.category] = (stats.byCategory[item.category] || 0) + 1;
      });

      return stats;
    } catch (error) {
      this.logger.error(`Failed to get wardrobe stats: ${error}`);
      throw error;
    }
  }
}
