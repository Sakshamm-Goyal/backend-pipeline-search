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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../../auth/infrastructure/guards/jwt-auth.guard';
import { WardrobeService } from '../../application/services/wardrobe.service';
import { CreateWardrobeItemDto } from '../../application/dtos/create-wardrobe-item.dto';
import { UpdateWardrobeItemDto } from '../../application/dtos/update-wardrobe-item.dto';
import { QueryWardrobeDto } from '../../application/dtos/query-wardrobe.dto';

@Controller('wardrobe')
@UseGuards(JwtAuthGuard)
export class WardrobeController {
  constructor(private readonly wardrobeService: WardrobeService) {}

  /**
   * POST /wardrobe
   * Create a new wardrobe item with image upload
   */
  @Post()
  @UseInterceptors(FileInterceptor('image'))
  async createItem(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateWardrobeItemDto,
  ) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    const userId = req.user.userId;
    return this.wardrobeService.createItem(userId, file, dto);
  }

  /**
   * GET /wardrobe
   * Get all wardrobe items for the authenticated user
   */
  @Get()
  async getUserItems(@Request() req: any, @Query() query: QueryWardrobeDto) {
    const userId = req.user.userId;
    return this.wardrobeService.getUserItems(userId, query);
  }

  /**
   * GET /wardrobe/stats
   * Get wardrobe statistics for the authenticated user
   */
  @Get('stats')
  async getUserStats(@Request() req: any) {
    const userId = req.user.userId;
    return this.wardrobeService.getUserStats(userId);
  }

  /**
   * GET /wardrobe/:id
   * Get a single wardrobe item by ID
   */
  @Get(':id')
  async getItemById(@Request() req: any, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.wardrobeService.getItemById(userId, id);
  }

  /**
   * PUT /wardrobe/:id
   * Update a wardrobe item
   */
  @Put(':id')
  async updateItem(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateWardrobeItemDto,
  ) {
    const userId = req.user.userId;
    return this.wardrobeService.updateItem(userId, id, dto);
  }

  /**
   * PUT /wardrobe/:id/image
   * Update wardrobe item image
   */
  @Put(':id/image')
  @UseInterceptors(FileInterceptor('image'))
  async updateItemImage(
    @Request() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    const userId = req.user.userId;
    return this.wardrobeService.updateItemImage(userId, id, file);
  }

  /**
   * DELETE /wardrobe/:id
   * Soft delete a wardrobe item
   */
  @Delete(':id')
  async deleteItem(@Request() req: any, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.wardrobeService.deleteItem(userId, id);
  }

  /**
   * POST /wardrobe/:id/restore
   * Restore a soft-deleted wardrobe item
   */
  @Post(':id/restore')
  async restoreItem(@Request() req: any, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.wardrobeService.restoreItem(userId, id);
  }

  /**
   * DELETE /wardrobe/:id/permanent
   * Permanently delete a wardrobe item and its images
   */
  @Delete(':id/permanent')
  async permanentDeleteItem(@Request() req: any, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.wardrobeService.permanentDeleteItem(userId, id);
  }

  /**
   * POST /wardrobe/:id/favorite
   * Toggle favorite status
   */
  @Post(':id/favorite')
  async toggleFavorite(@Request() req: any, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.wardrobeService.toggleFavorite(userId, id);
  }

  /**
   * POST /wardrobe/:id/worn
   * Increment times worn counter
   */
  @Post(':id/worn')
  async incrementTimesWorn(@Request() req: any, @Param('id') id: string) {
    const userId = req.user.userId;
    return this.wardrobeService.incrementTimesWorn(userId, id);
  }
}
