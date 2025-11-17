import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { OutfitRepository, OutfitQuery } from '../../infrastructure/repositories/outfit.repository';
import { CreateOutfitDto } from '../dtos/create-outfit.dto';
import { UpdateOutfitDto } from '../dtos/update-outfit.dto';
import { QueryOutfitDto } from '../dtos/query-outfit.dto';

@Injectable()
export class OutfitService {
  private readonly logger = new Logger(OutfitService.name);

  constructor(private outfitRepository: OutfitRepository) {}

  /**
   * Create a new outfit combination
   */
  async createOutfit(userId: string, dto: CreateOutfitDto) {
    try {
      const outfit = await this.outfitRepository.create({
        userId: new Types.ObjectId(userId),
        name: dto.name,
        description: dto.description,
        items: dto.items.map((item) => ({
          wardrobeItemId: new Types.ObjectId(item.wardrobeItemId),
          category: item.category,
          subcategory: item.subcategory,
        })),
        occasion: dto.occasion || [],
        season: dto.season || [],
        aiGenerated: false,
        createdBy: 'user',
        notes: dto.notes,
        isFavorite: dto.isFavorite || false,
        timesWorn: 0,
        isDeleted: false,
      });

      this.logger.log(`Outfit created: ${outfit.id} for userId: ${userId}`);

      return outfit;
    } catch (error) {
      this.logger.error(`Failed to create outfit: ${error}`);
      throw error;
    }
  }

  /**
   * Get all outfits for a user with optional filters
   */
  async getUserOutfits(userId: string, query: QueryOutfitDto) {
    try {
      const outfitQuery: OutfitQuery = {
        userId,
        isFavorite: query.isFavorite,
        occasion: query.occasion,
        season: query.season,
      };

      const outfits = await this.outfitRepository.findByUser(outfitQuery);

      return {
        outfits,
        count: outfits.length,
      };
    } catch (error) {
      this.logger.error(`Failed to get outfits: ${error}`);
      throw error;
    }
  }

  /**
   * Get a single outfit by ID
   */
  async getOutfitById(userId: string, outfitId: string) {
    try {
      const outfit = await this.outfitRepository.findById(outfitId);

      if (!outfit) {
        throw new NotFoundException('Outfit not found');
      }

      // Verify ownership
      if (outfit.userId.toString() !== userId) {
        throw new ForbiddenException('You do not have access to this outfit');
      }

      return outfit;
    } catch (error) {
      this.logger.error(`Failed to get outfit: ${error}`);
      throw error;
    }
  }

  /**
   * Update an outfit
   */
  async updateOutfit(userId: string, outfitId: string, dto: UpdateOutfitDto) {
    try {
      const outfit = await this.outfitRepository.findById(outfitId);

      if (!outfit) {
        throw new NotFoundException('Outfit not found');
      }

      // Verify ownership
      if (outfit.userId.toString() !== userId) {
        throw new ForbiddenException('You do not have access to this outfit');
      }

      const updateData: any = {
        ...dto,
      };

      if (dto.items) {
        updateData.items = dto.items.map((item) => ({
          wardrobeItemId: new Types.ObjectId(item.wardrobeItemId),
          category: item.category,
          subcategory: item.subcategory,
        }));
      }

      const updated = await this.outfitRepository.update(outfitId, updateData);

      this.logger.log(`Outfit updated: ${outfitId}`);

      return updated;
    } catch (error) {
      this.logger.error(`Failed to update outfit: ${error}`);
      throw error;
    }
  }

  /**
   * Delete an outfit (soft delete)
   */
  async deleteOutfit(userId: string, outfitId: string) {
    try {
      const outfit = await this.outfitRepository.findById(outfitId);

      if (!outfit) {
        throw new NotFoundException('Outfit not found');
      }

      // Verify ownership
      if (outfit.userId.toString() !== userId) {
        throw new ForbiddenException('You do not have access to this outfit');
      }

      await this.outfitRepository.softDelete(outfitId);

      this.logger.log(`Outfit deleted: ${outfitId}`);

      return { message: 'Outfit deleted successfully' };
    } catch (error) {
      this.logger.error(`Failed to delete outfit: ${error}`);
      throw error;
    }
  }

  /**
   * Toggle favorite status
   */
  async toggleFavorite(userId: string, outfitId: string) {
    try {
      const outfit = await this.outfitRepository.findById(outfitId);

      if (!outfit) {
        throw new NotFoundException('Outfit not found');
      }

      // Verify ownership
      if (outfit.userId.toString() !== userId) {
        throw new ForbiddenException('You do not have access to this outfit');
      }

      const updated = await this.outfitRepository.update(outfitId, {
        isFavorite: !outfit.isFavorite,
      });

      this.logger.log(`Outfit favorite toggled: ${outfitId}`);

      return updated;
    } catch (error) {
      this.logger.error(`Failed to toggle favorite: ${error}`);
      throw error;
    }
  }

  /**
   * Increment times worn
   */
  async incrementTimesWorn(userId: string, outfitId: string) {
    try {
      const outfit = await this.outfitRepository.findById(outfitId);

      if (!outfit) {
        throw new NotFoundException('Outfit not found');
      }

      // Verify ownership
      if (outfit.userId.toString() !== userId) {
        throw new ForbiddenException('You do not have access to this outfit');
      }

      const updated = await this.outfitRepository.update(outfitId, {
        timesWorn: outfit.timesWorn + 1,
        lastWornAt: new Date(),
      });

      this.logger.log(`Outfit times worn incremented: ${outfitId}`);

      return updated;
    } catch (error) {
      this.logger.error(`Failed to increment times worn: ${error}`);
      throw error;
    }
  }

  /**
   * Get outfits containing a specific wardrobe item
   */
  async getOutfitsByWardrobeItem(userId: string, wardrobeItemId: string) {
    try {
      const outfits = await this.outfitRepository.findByWardrobeItem(wardrobeItemId);

      // Filter by user ownership
      const userOutfits = outfits.filter(
        (outfit) => outfit.userId.toString() === userId,
      );

      return {
        outfits: userOutfits,
        count: userOutfits.length,
      };
    } catch (error) {
      this.logger.error(`Failed to get outfits by wardrobe item: ${error}`);
      throw error;
    }
  }
}
