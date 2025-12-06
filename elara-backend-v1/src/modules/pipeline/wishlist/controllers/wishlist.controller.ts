import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Request,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { WishlistRepository, AddToWishlistParams } from '../infrastructure/persistence/wishlist.repository';
import { AnalyticsService } from '../../analytics/analytics.service';

/**
 * Wishlist Controller
 *
 * REST API endpoints for managing user wishlists.
 *
 * Endpoints:
 * - GET /wishlist - Get user's wishlist
 * - GET /wishlist/stats - Get wishlist statistics
 * - GET /wishlist/collections - Get user's collections
 * - GET /wishlist/price-drops - Get items with price drops
 * - POST /wishlist - Add item to wishlist
 * - DELETE /wishlist/:productId - Remove item from wishlist
 * - PATCH /wishlist/:productId/collection - Move to collection
 * - PATCH /wishlist/:productId/notes - Update notes
 * - PATCH /wishlist/:productId/alert - Set price alert
 * - PATCH /wishlist/:productId/purchased - Mark as purchased
 */

// DTOs
interface AddToWishlistDto {
  productId: string;
  productTitle: string;
  productBrand?: string;
  productImageUrl: string;
  productUrl: string;
  productCategory?: string;
  savedPrice: number;
  savedCurrency?: string;
  collectionName?: string;
  addedFrom?: string;
  conversationId?: string;
  notes?: {
    text?: string;
    tags?: string[];
    priority?: 'low' | 'medium' | 'high';
    occasion?: string;
  };
}

interface GetWishlistQueryDto {
  collectionName?: string;
  page?: string;
  limit?: string;
  sortBy?: 'createdAt' | 'productTitle' | 'savedPrice' | 'priceDropPercent';
  sortOrder?: 'asc' | 'desc';
  includePurchased?: string;
}

interface UpdateNotesDto {
  text?: string;
  tags?: string[];
  priority?: 'low' | 'medium' | 'high';
  occasion?: string;
}

interface SetPriceAlertDto {
  threshold?: number;
}

interface MoveToCollectionDto {
  collectionName: string | null;
}

@Controller('pipeline/wishlist')
export class WishlistController {
  private readonly logger = new Logger(WishlistController.name);

  constructor(
    private wishlistRepository: WishlistRepository,
    private analyticsService: AnalyticsService,
  ) {}

  /**
   * Get user's wishlist with pagination
   */
  @Get()
  async getWishlist(@Request() req: any, @Query() query: GetWishlistQueryDto) {
    const userId = req.user.id;

    const result = await this.wishlistRepository.getUserWishlist(userId, {
      collectionName: query.collectionName,
      page: query.page ? parseInt(query.page, 10) : 1,
      limit: query.limit ? parseInt(query.limit, 10) : 20,
      sortBy: query.sortBy || 'createdAt',
      sortOrder: query.sortOrder || 'desc',
      includePurchased: query.includePurchased === 'true',
    });

    return {
      success: true,
      data: {
        items: result.items,
        total: result.total,
        page: query.page ? parseInt(query.page, 10) : 1,
        limit: query.limit ? parseInt(query.limit, 10) : 20,
        totalPages: Math.ceil(result.total / (query.limit ? parseInt(query.limit, 10) : 20)),
      },
    };
  }

  /**
   * Get wishlist statistics
   */
  @Get('stats')
  async getStats(@Request() req: any) {
    const userId = req.user.id;
    const stats = await this.wishlistRepository.getStats(userId);

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * Get user's collections
   */
  @Get('collections')
  async getCollections(@Request() req: any) {
    const userId = req.user.id;
    const collections = await this.wishlistRepository.getUserCollections(userId);

    return {
      success: true,
      data: collections,
    };
  }

  /**
   * Get items with price drops
   */
  @Get('price-drops')
  async getPriceDrops(@Request() req: any) {
    const userId = req.user.id;
    const items = await this.wishlistRepository.getItemsWithPriceDrops(userId);

    return {
      success: true,
      data: items,
    };
  }

  /**
   * Check if product is in wishlist
   */
  @Get('check/:productId')
  async checkWishlist(@Request() req: any, @Param('productId') productId: string) {
    const userId = req.user.id;
    const isInWishlist = await this.wishlistRepository.isInWishlist(userId, productId);

    return {
      success: true,
      data: { isInWishlist },
    };
  }

  /**
   * Add item to wishlist
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async addToWishlist(@Request() req: any, @Body() dto: AddToWishlistDto) {
    const userId = req.user.id;

    const params: AddToWishlistParams = {
      userId,
      productId: dto.productId,
      productTitle: dto.productTitle,
      productBrand: dto.productBrand,
      productImageUrl: dto.productImageUrl,
      productUrl: dto.productUrl,
      productCategory: dto.productCategory,
      savedPrice: dto.savedPrice,
      savedCurrency: dto.savedCurrency || 'USD',
      collectionName: dto.collectionName,
      addedFrom: dto.addedFrom || 'api',
      conversationId: dto.conversationId,
      notes: dto.notes,
    };

    const item = await this.wishlistRepository.addItem(params);

    // Track analytics (non-blocking)
    this.analyticsService.trackProductSave(userId, {
      productId: dto.productId,
      category: dto.productCategory,
      brand: dto.productBrand,
      price: dto.savedPrice,
    });

    this.logger.log(`Added product ${dto.productId} to wishlist for user ${userId}`);

    return {
      success: true,
      data: item,
    };
  }

  /**
   * Remove item from wishlist
   */
  @Delete(':productId')
  @HttpCode(HttpStatus.OK)
  async removeFromWishlist(@Request() req: any, @Param('productId') productId: string) {
    const userId = req.user.id;

    const removed = await this.wishlistRepository.removeItem(userId, productId);

    if (!removed) {
      return {
        success: false,
        message: 'Item not found in wishlist',
      };
    }

    // Track analytics (non-blocking)
    this.analyticsService.trackProductUnsave(userId, productId);

    this.logger.log(`Removed product ${productId} from wishlist for user ${userId}`);

    return {
      success: true,
      message: 'Item removed from wishlist',
    };
  }

  /**
   * Move item to collection
   */
  @Patch(':productId/collection')
  async moveToCollection(
    @Request() req: any,
    @Param('productId') productId: string,
    @Body() dto: MoveToCollectionDto,
  ) {
    const userId = req.user.id;

    const updated = await this.wishlistRepository.moveToCollection(
      userId,
      productId,
      dto.collectionName,
    );

    if (!updated) {
      return {
        success: false,
        message: 'Item not found in wishlist',
      };
    }

    return {
      success: true,
      message: dto.collectionName
        ? `Moved to collection "${dto.collectionName}"`
        : 'Removed from collection',
    };
  }

  /**
   * Update item notes
   */
  @Patch(':productId/notes')
  async updateNotes(
    @Request() req: any,
    @Param('productId') productId: string,
    @Body() dto: UpdateNotesDto,
  ) {
    const userId = req.user.id;

    const updated = await this.wishlistRepository.updateNotes(userId, productId, dto);

    if (!updated) {
      return {
        success: false,
        message: 'Item not found in wishlist',
      };
    }

    return {
      success: true,
      message: 'Notes updated',
    };
  }

  /**
   * Set price alert
   */
  @Patch(':productId/alert')
  async setPriceAlert(
    @Request() req: any,
    @Param('productId') productId: string,
    @Body() dto: SetPriceAlertDto,
  ) {
    const userId = req.user.id;

    const updated = await this.wishlistRepository.setPriceAlert(
      userId,
      productId,
      dto.threshold,
    );

    if (!updated) {
      return {
        success: false,
        message: 'Item not found in wishlist',
      };
    }

    return {
      success: true,
      message: 'Price alert set',
    };
  }

  /**
   * Mark item as purchased
   */
  @Patch(':productId/purchased')
  async markAsPurchased(@Request() req: any, @Param('productId') productId: string) {
    const userId = req.user.id;

    const updated = await this.wishlistRepository.markAsPurchased(userId, productId);

    if (!updated) {
      return {
        success: false,
        message: 'Item not found in wishlist',
      };
    }

    return {
      success: true,
      message: 'Item marked as purchased',
    };
  }
}
