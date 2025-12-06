import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WishlistItem, WishlistItemSchema } from './domain/schemas/wishlist-item.schema';
import { WishlistRepository } from './infrastructure/persistence/wishlist.repository';
import { WishlistController } from './controllers/wishlist.controller';
import { AnalyticsModule } from '../analytics/analytics.module';

/**
 * Wishlist Module
 *
 * Provides saved products functionality.
 *
 * Features:
 * - Save/unsave products
 * - Organize into collections
 * - Price tracking and alerts
 * - Notes and priority
 * - Purchase tracking
 *
 * API Endpoints:
 * - GET /pipeline/wishlist - Get user's wishlist
 * - GET /pipeline/wishlist/stats - Get statistics
 * - GET /pipeline/wishlist/collections - Get collections
 * - GET /pipeline/wishlist/price-drops - Get price drops
 * - GET /pipeline/wishlist/check/:productId - Check if saved
 * - POST /pipeline/wishlist - Add to wishlist
 * - DELETE /pipeline/wishlist/:productId - Remove from wishlist
 * - PATCH /pipeline/wishlist/:productId/collection - Move to collection
 * - PATCH /pipeline/wishlist/:productId/notes - Update notes
 * - PATCH /pipeline/wishlist/:productId/alert - Set price alert
 * - PATCH /pipeline/wishlist/:productId/purchased - Mark purchased
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WishlistItem.name, schema: WishlistItemSchema },
    ]),
    AnalyticsModule,
  ],
  controllers: [WishlistController],
  providers: [WishlistRepository],
  exports: [WishlistRepository],
})
export class WishlistModule {}
