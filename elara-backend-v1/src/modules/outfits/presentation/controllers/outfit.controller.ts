import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/infrastructure/guards/jwt-auth.guard';
import { OutfitService } from '../../application/services/outfit.service';
import { CreateOutfitDto } from '../../application/dtos/create-outfit.dto';
import { UpdateOutfitDto } from '../../application/dtos/update-outfit.dto';
import { QueryOutfitDto } from '../../application/dtos/query-outfit.dto';

@Controller('outfits')
@UseGuards(JwtAuthGuard)
export class OutfitController {
  constructor(private readonly outfitService: OutfitService) {}

  /**
   * POST /outfits
   * Create a new outfit combination
   */
  @Post()
  async createOutfit(@Request() req: any, @Body() dto: CreateOutfitDto) {
    const userId = req.user.userId;
    return this.outfitService.createOutfit(userId, dto);
  }

  /**
   * GET /outfits
   * Get all outfits for the authenticated user
   */
  @Get()
  async getUserOutfits(@Request() req: any, @Query() query: QueryOutfitDto) {
    const userId = req.user.userId;
    return this.outfitService.getUserOutfits(userId, query);
  }

  /**
   * GET /outfits/:id
   * Get a single outfit by ID
   */
  @Get(':id')
  async getOutfitById(@Request() req: any, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.outfitService.getOutfitById(userId, id);
  }

  /**
   * GET /outfits/wardrobe-item/:wardrobeItemId
   * Get outfits containing a specific wardrobe item
   */
  @Get('wardrobe-item/:wardrobeItemId')
  async getOutfitsByWardrobeItem(
    @Request() req: any,
    @Param('wardrobeItemId') wardrobeItemId: string,
  ) {
    const userId = req.user.userId;
    return this.outfitService.getOutfitsByWardrobeItem(userId, wardrobeItemId);
  }

  /**
   * PUT /outfits/:id
   * Update an outfit
   */
  @Put(':id')
  async updateOutfit(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateOutfitDto,
  ) {
    const userId = req.user.userId;
    return this.outfitService.updateOutfit(userId, id, dto);
  }

  /**
   * DELETE /outfits/:id
   * Soft delete an outfit
   */
  @Delete(':id')
  async deleteOutfit(@Request() req: any, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.outfitService.deleteOutfit(userId, id);
  }

  /**
   * POST /outfits/:id/favorite
   * Toggle favorite status
   */
  @Post(':id/favorite')
  async toggleFavorite(@Request() req: any, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.outfitService.toggleFavorite(userId, id);
  }

  /**
   * POST /outfits/:id/worn
   * Increment times worn counter
   */
  @Post(':id/worn')
  async incrementTimesWorn(@Request() req: any, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.outfitService.incrementTimesWorn(userId, id);
  }
}
