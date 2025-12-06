import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WishlistItem, WishlistNotes } from '../../domain/schemas/wishlist-item.schema';

/**
 * Wishlist Repository
 *
 * Handles all wishlist persistence operations.
 */

export interface AddToWishlistParams {
  userId: string;
  productId: string;
  productTitle: string;
  productBrand?: string;
  productImageUrl: string;
  productUrl: string;
  productCategory?: string;
  savedPrice: number;
  savedCurrency: string;
  collectionName?: string;
  addedFrom?: string;
  conversationId?: string;
  notes?: Partial<WishlistNotes>;
}

export interface WishlistStats {
  totalItems: number;
  byCollection: Record<string, number>;
  totalSavedValue: number;
  priceDropCount: number;
  purchasedCount: number;
}

@Injectable()
export class WishlistRepository {
  private readonly logger = new Logger(WishlistRepository.name);

  constructor(
    @InjectModel(WishlistItem.name)
    private wishlistModel: Model<WishlistItem>,
  ) {}

  /**
   * Add item to wishlist
   * Returns existing item if already saved (idempotent)
   */
  async addItem(params: AddToWishlistParams): Promise<WishlistItem> {
    try {
      // Check if already exists
      const existing = await this.wishlistModel.findOne({
        userId: new Types.ObjectId(params.userId),
        productId: new Types.ObjectId(params.productId),
        isDeleted: false,
      });

      if (existing) {
        this.logger.debug(`Product ${params.productId} already in wishlist`);
        return existing;
      }

      const item = new this.wishlistModel({
        userId: new Types.ObjectId(params.userId),
        productId: new Types.ObjectId(params.productId),
        productTitle: params.productTitle,
        productBrand: params.productBrand,
        productImageUrl: params.productImageUrl,
        productUrl: params.productUrl,
        productCategory: params.productCategory,
        savedPrice: params.savedPrice,
        savedCurrency: params.savedCurrency,
        currentPrice: params.savedPrice,
        collectionName: params.collectionName,
        addedFrom: params.addedFrom,
        conversationId: params.conversationId,
        notes: params.notes,
        priceHistory: [
          {
            price: params.savedPrice,
            currency: params.savedCurrency,
            recordedAt: new Date(),
            source: 'initial',
          },
        ],
      });

      await item.save();
      this.logger.debug(`Added product ${params.productId} to wishlist`);
      return item;
    } catch (error) {
      const err = error as Error;
      // Handle duplicate key error gracefully
      if (err.message.includes('duplicate key')) {
        const existing = await this.wishlistModel.findOne({
          userId: new Types.ObjectId(params.userId),
          productId: new Types.ObjectId(params.productId),
        });
        if (existing) return existing;
      }
      this.logger.error(`Error adding to wishlist: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Remove item from wishlist (soft delete)
   */
  async removeItem(userId: string, productId: string): Promise<boolean> {
    try {
      const result = await this.wishlistModel.updateOne(
        {
          userId: new Types.ObjectId(userId),
          productId: new Types.ObjectId(productId),
          isDeleted: false,
        },
        {
          $set: { isDeleted: true, deletedAt: new Date() },
        },
      );

      return result.modifiedCount > 0;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error removing from wishlist: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Check if product is in user's wishlist
   */
  async isInWishlist(userId: string, productId: string): Promise<boolean> {
    try {
      const count = await this.wishlistModel.countDocuments({
        userId: new Types.ObjectId(userId),
        productId: new Types.ObjectId(productId),
        isDeleted: false,
      });
      return count > 0;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error checking wishlist: ${err.message}`, err.stack);
      return false;
    }
  }

  /**
   * Get user's wishlist with pagination
   */
  async getUserWishlist(
    userId: string,
    options: {
      collectionName?: string;
      page?: number;
      limit?: number;
      sortBy?: 'createdAt' | 'productTitle' | 'savedPrice' | 'priceDropPercent';
      sortOrder?: 'asc' | 'desc';
      includePurchased?: boolean;
    } = {},
  ): Promise<{ items: WishlistItem[]; total: number }> {
    const {
      collectionName,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      includePurchased = false,
    } = options;

    try {
      const query: any = {
        userId: new Types.ObjectId(userId),
        isDeleted: false,
      };

      if (collectionName) {
        query.collectionName = collectionName;
      }

      if (!includePurchased) {
        query.isPurchased = false;
      }

      const skip = (page - 1) * limit;
      const sortOptions: any = {};
      sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

      const [items, total] = await Promise.all([
        this.wishlistModel.find(query).sort(sortOptions).skip(skip).limit(limit),
        this.wishlistModel.countDocuments(query),
      ]);

      return { items, total };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting wishlist: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get user's collections
   */
  async getUserCollections(userId: string): Promise<Array<{ name: string; count: number }>> {
    try {
      const result = await this.wishlistModel.aggregate([
        {
          $match: {
            userId: new Types.ObjectId(userId),
            isDeleted: false,
            isPurchased: false,
          },
        },
        {
          $group: {
            _id: { $ifNull: ['$collectionName', 'Uncategorized'] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]);

      return result.map((r) => ({ name: r._id, count: r.count }));
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting collections: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Move item to a collection
   */
  async moveToCollection(
    userId: string,
    productId: string,
    collectionName: string | null,
  ): Promise<boolean> {
    try {
      const result = await this.wishlistModel.updateOne(
        {
          userId: new Types.ObjectId(userId),
          productId: new Types.ObjectId(productId),
          isDeleted: false,
        },
        { $set: { collectionName } },
      );

      return result.modifiedCount > 0;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error moving to collection: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Update notes for an item
   */
  async updateNotes(
    userId: string,
    productId: string,
    notes: Partial<WishlistNotes>,
  ): Promise<boolean> {
    try {
      const result = await this.wishlistModel.updateOne(
        {
          userId: new Types.ObjectId(userId),
          productId: new Types.ObjectId(productId),
          isDeleted: false,
        },
        {
          $set: {
            'notes.text': notes.text,
            'notes.tags': notes.tags,
            'notes.priority': notes.priority,
            'notes.occasion': notes.occasion,
            'notes.updatedAt': new Date(),
          },
        },
      );

      return result.modifiedCount > 0;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error updating notes: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Set price alert
   */
  async setPriceAlert(
    userId: string,
    productId: string,
    threshold?: number,
  ): Promise<boolean> {
    try {
      const result = await this.wishlistModel.updateOne(
        {
          userId: new Types.ObjectId(userId),
          productId: new Types.ObjectId(productId),
          isDeleted: false,
        },
        {
          $set: {
            hasPriceAlert: true,
            alertThreshold: threshold,
          },
        },
      );

      return result.modifiedCount > 0;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error setting price alert: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Mark item as purchased
   */
  async markAsPurchased(userId: string, productId: string): Promise<boolean> {
    try {
      const result = await this.wishlistModel.updateOne(
        {
          userId: new Types.ObjectId(userId),
          productId: new Types.ObjectId(productId),
          isDeleted: false,
        },
        {
          $set: {
            isPurchased: true,
            purchasedAt: new Date(),
          },
        },
      );

      return result.modifiedCount > 0;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error marking as purchased: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Update price for an item (for price tracking)
   */
  async updatePrice(
    productId: string,
    newPrice: number,
    currency: string,
  ): Promise<number> {
    try {
      // Update all wishlist items with this product
      const items = await this.wishlistModel.find({
        productId: new Types.ObjectId(productId),
        isDeleted: false,
        isPurchased: false,
      });

      let updatedCount = 0;

      for (const item of items) {
        const priceDropPercent = item.savedPrice > newPrice
          ? Math.round(((item.savedPrice - newPrice) / item.savedPrice) * 100)
          : undefined;

        await this.wishlistModel.updateOne(
          { _id: item._id },
          {
            $set: {
              currentPrice: newPrice,
              priceDropPercent,
            },
            $push: {
              priceHistory: {
                price: newPrice,
                currency,
                recordedAt: new Date(),
                source: 'price_check',
              },
            },
          },
        );

        updatedCount++;
      }

      return updatedCount;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error updating price: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get items with price drops
   */
  async getItemsWithPriceDrops(userId: string): Promise<WishlistItem[]> {
    try {
      return await this.wishlistModel.find({
        userId: new Types.ObjectId(userId),
        isDeleted: false,
        isPurchased: false,
        priceDropPercent: { $gt: 0 },
      }).sort({ priceDropPercent: -1 });
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting price drops: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get items with active price alerts below threshold
   */
  async getItemsBelowAlertThreshold(): Promise<WishlistItem[]> {
    try {
      return await this.wishlistModel.find({
        isDeleted: false,
        isPurchased: false,
        hasPriceAlert: true,
        alertThreshold: { $exists: true },
        $expr: { $lte: ['$currentPrice', '$alertThreshold'] },
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting alert items: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get wishlist statistics
   */
  async getStats(userId: string): Promise<WishlistStats> {
    try {
      const [totalItems, byCollection, valueAgg, priceDropCount, purchasedCount] =
        await Promise.all([
          // Total items
          this.wishlistModel.countDocuments({
            userId: new Types.ObjectId(userId),
            isDeleted: false,
            isPurchased: false,
          }),

          // By collection
          this.wishlistModel.aggregate([
            {
              $match: {
                userId: new Types.ObjectId(userId),
                isDeleted: false,
                isPurchased: false,
              },
            },
            {
              $group: {
                _id: { $ifNull: ['$collectionName', 'Uncategorized'] },
                count: { $sum: 1 },
              },
            },
          ]),

          // Total saved value
          this.wishlistModel.aggregate([
            {
              $match: {
                userId: new Types.ObjectId(userId),
                isDeleted: false,
                isPurchased: false,
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: '$savedPrice' },
              },
            },
          ]),

          // Price drop count
          this.wishlistModel.countDocuments({
            userId: new Types.ObjectId(userId),
            isDeleted: false,
            isPurchased: false,
            priceDropPercent: { $gt: 0 },
          }),

          // Purchased count
          this.wishlistModel.countDocuments({
            userId: new Types.ObjectId(userId),
            isDeleted: false,
            isPurchased: true,
          }),
        ]);

      return {
        totalItems,
        byCollection: byCollection.reduce(
          (acc, item) => ({ ...acc, [item._id]: item.count }),
          {},
        ),
        totalSavedValue: valueAgg[0]?.total || 0,
        priceDropCount,
        purchasedCount,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting stats: ${err.message}`, err.stack);
      throw error;
    }
  }
}
