import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UserEvent,
  EventType,
  EventContext,
  SearchEventData,
  ProductEventData,
  WardrobeEventData,
  ChatEventData,
} from '../../domain/schemas/user-event.schema';

/**
 * User Event Repository
 *
 * Handles tracking and querying of user behavior events.
 * Used for:
 * - Real-time event tracking
 * - User behavior analysis
 * - Personalization data
 * - Analytics aggregation
 */

export interface TrackEventParams {
  userId: string;
  eventType: EventType;
  context?: Partial<EventContext>;
  searchData?: Partial<SearchEventData>;
  productData?: Partial<ProductEventData>;
  wardrobeData?: Partial<WardrobeEventData>;
  chatData?: Partial<ChatEventData>;
  customData?: Record<string, any>;
  userSnapshot?: {
    gender?: string;
    stylePreferences?: string[];
    priceRange?: { min: number; max: number };
  };
}

export interface UserEventStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  recentActivity: Date | null;
  topSearchTerms: Array<{ term: string; count: number }>;
  topCategories: Array<{ category: string; count: number }>;
  topBrands: Array<{ brand: string; count: number }>;
}

export interface AggregatedBehavior {
  preferredCategories: string[];
  preferredBrands: string[];
  preferredPriceRange: { min: number; max: number };
  preferredStyles: string[];
  searchPatterns: string[];
  engagementScore: number;
}

@Injectable()
export class UserEventRepository {
  private readonly logger = new Logger(UserEventRepository.name);

  constructor(
    @InjectModel(UserEvent.name)
    private eventModel: Model<UserEvent>,
  ) {}

  /**
   * Track a user event
   */
  async track(params: TrackEventParams): Promise<void> {
    try {
      const event = new this.eventModel({
        userId: new Types.ObjectId(params.userId),
        eventType: params.eventType,
        timestamp: new Date(),
        context: params.context,
        searchData: params.searchData,
        productData: params.productData,
        wardrobeData: params.wardrobeData,
        chatData: params.chatData,
        customData: params.customData,
        userSnapshot: params.userSnapshot,
      });

      await event.save();
      this.logger.debug(`Tracked event: ${params.eventType} for user ${params.userId}`);
    } catch (error) {
      const err = error as Error;
      // Don't throw - tracking failures shouldn't break the app
      this.logger.error(`Failed to track event: ${err.message}`, err.stack);
    }
  }

  /**
   * Track multiple events in batch (more efficient)
   */
  async trackBatch(events: TrackEventParams[]): Promise<void> {
    if (events.length === 0) return;

    try {
      const documents = events.map((params) => ({
        userId: new Types.ObjectId(params.userId),
        eventType: params.eventType,
        timestamp: new Date(),
        context: params.context,
        searchData: params.searchData,
        productData: params.productData,
        wardrobeData: params.wardrobeData,
        chatData: params.chatData,
        customData: params.customData,
        userSnapshot: params.userSnapshot,
      }));

      await this.eventModel.insertMany(documents, { ordered: false });
      this.logger.debug(`Tracked ${events.length} events in batch`);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to track batch events: ${err.message}`, err.stack);
    }
  }

  /**
   * Get user events with pagination
   */
  async getUserEvents(
    userId: string,
    options: {
      eventTypes?: EventType[];
      startDate?: Date;
      endDate?: Date;
      page?: number;
      limit?: number;
    } = {},
  ): Promise<{ events: UserEvent[]; total: number }> {
    const { eventTypes, startDate, endDate, page = 1, limit = 50 } = options;

    try {
      const query: any = {
        userId: new Types.ObjectId(userId),
        isAnonymized: false,
      };

      if (eventTypes?.length) {
        query.eventType = { $in: eventTypes };
      }

      if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = startDate;
        if (endDate) query.timestamp.$lte = endDate;
      }

      const skip = (page - 1) * limit;

      const [events, total] = await Promise.all([
        this.eventModel.find(query).sort({ timestamp: -1 }).skip(skip).limit(limit),
        this.eventModel.countDocuments(query),
      ]);

      return { events, total };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to get user events: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get user event statistics
   */
  async getUserStats(userId: string, days: number = 30): Promise<UserEventStats> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);

      const [totalEvents, eventsByType, recentActivity, topSearchTerms, topCategories, topBrands] =
        await Promise.all([
          // Total events
          this.eventModel.countDocuments({
            userId: new Types.ObjectId(userId),
            timestamp: { $gte: cutoff },
          }),

          // Events by type
          this.eventModel.aggregate([
            {
              $match: {
                userId: new Types.ObjectId(userId),
                timestamp: { $gte: cutoff },
              },
            },
            { $group: { _id: '$eventType', count: { $sum: 1 } } },
          ]),

          // Most recent activity
          this.eventModel
            .findOne({ userId: new Types.ObjectId(userId) })
            .sort({ timestamp: -1 })
            .select('timestamp'),

          // Top search terms
          this.eventModel.aggregate([
            {
              $match: {
                userId: new Types.ObjectId(userId),
                eventType: EventType.SEARCH,
                timestamp: { $gte: cutoff },
                'searchData.query': { $exists: true },
              },
            },
            { $group: { _id: '$searchData.query', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ]),

          // Top categories
          this.eventModel.aggregate([
            {
              $match: {
                userId: new Types.ObjectId(userId),
                'productData.category': { $exists: true },
                timestamp: { $gte: cutoff },
              },
            },
            { $group: { _id: '$productData.category', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ]),

          // Top brands
          this.eventModel.aggregate([
            {
              $match: {
                userId: new Types.ObjectId(userId),
                'productData.brand': { $exists: true },
                timestamp: { $gte: cutoff },
              },
            },
            { $group: { _id: '$productData.brand', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ]),
        ]);

      return {
        totalEvents,
        eventsByType: eventsByType.reduce(
          (acc, item) => ({ ...acc, [item._id]: item.count }),
          {},
        ),
        recentActivity: recentActivity?.timestamp || null,
        topSearchTerms: topSearchTerms.map((t) => ({
          term: t._id,
          count: t.count,
        })),
        topCategories: topCategories.map((c) => ({
          category: c._id,
          count: c.count,
        })),
        topBrands: topBrands.map((b) => ({ brand: b._id, count: b.count })),
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to get user stats: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get aggregated user behavior for personalization
   */
  async getAggregatedBehavior(
    userId: string,
    days: number = 90,
  ): Promise<AggregatedBehavior> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);

      const [categoryData, brandData, priceData, searchData, engagementData] =
        await Promise.all([
          // Category preferences (weighted by action type)
          this.eventModel.aggregate([
            {
              $match: {
                userId: new Types.ObjectId(userId),
                'productData.category': { $exists: true },
                timestamp: { $gte: cutoff },
              },
            },
            {
              $group: {
                _id: '$productData.category',
                score: {
                  $sum: {
                    $switch: {
                      branches: [
                        { case: { $eq: ['$eventType', EventType.PRODUCT_CLICK] }, then: 5 },
                        { case: { $eq: ['$eventType', EventType.PRODUCT_SAVE] }, then: 10 },
                        { case: { $eq: ['$eventType', EventType.PRODUCT_VIEW] }, then: 1 },
                      ],
                      default: 1,
                    },
                  },
                },
              },
            },
            { $sort: { score: -1 } },
            { $limit: 5 },
          ]),

          // Brand preferences
          this.eventModel.aggregate([
            {
              $match: {
                userId: new Types.ObjectId(userId),
                'productData.brand': { $exists: true },
                timestamp: { $gte: cutoff },
              },
            },
            {
              $group: {
                _id: '$productData.brand',
                score: {
                  $sum: {
                    $switch: {
                      branches: [
                        { case: { $eq: ['$eventType', EventType.PRODUCT_CLICK] }, then: 5 },
                        { case: { $eq: ['$eventType', EventType.PRODUCT_SAVE] }, then: 10 },
                      ],
                      default: 1,
                    },
                  },
                },
              },
            },
            { $sort: { score: -1 } },
            { $limit: 10 },
          ]),

          // Price range preferences (using simpler aggregation for compatibility)
          this.eventModel.aggregate([
            {
              $match: {
                userId: new Types.ObjectId(userId),
                'productData.price': { $exists: true, $gt: 0 },
                timestamp: { $gte: cutoff },
              },
            },
            {
              $group: {
                _id: null,
                avgPrice: { $avg: '$productData.price' },
                minPrice: { $min: '$productData.price' },
                maxPrice: { $max: '$productData.price' },
                prices: { $push: '$productData.price' },
              },
            },
          ]),

          // Search patterns
          this.eventModel.aggregate([
            {
              $match: {
                userId: new Types.ObjectId(userId),
                eventType: EventType.SEARCH,
                'searchData.query': { $exists: true },
                timestamp: { $gte: cutoff },
              },
            },
            { $group: { _id: '$searchData.query', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 20 },
          ]),

          // Engagement score
          this.eventModel.aggregate([
            {
              $match: {
                userId: new Types.ObjectId(userId),
                timestamp: { $gte: cutoff },
              },
            },
            {
              $group: {
                _id: null,
                totalActions: { $sum: 1 },
                uniqueDays: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } } },
                clicks: {
                  $sum: { $cond: [{ $eq: ['$eventType', EventType.PRODUCT_CLICK] }, 1, 0] },
                },
                saves: {
                  $sum: { $cond: [{ $eq: ['$eventType', EventType.PRODUCT_SAVE] }, 1, 0] },
                },
              },
            },
            {
              $project: {
                score: {
                  $multiply: [
                    { $size: '$uniqueDays' },
                    { $add: [1, { $divide: ['$clicks', { $max: ['$totalActions', 1] }] }] },
                    { $add: [1, { $divide: ['$saves', { $max: ['$totalActions', 1] }] }] },
                  ],
                },
              },
            },
          ]),
        ]);

      // Process price range from collected prices
      let priceRange = { min: 0, max: 500 }; // Default
      if (priceData.length > 0 && priceData[0].prices?.length > 0) {
        const sortedPrices = priceData[0].prices.sort((a: number, b: number) => a - b);
        const p25Index = Math.floor(sortedPrices.length * 0.25);
        const p75Index = Math.floor(sortedPrices.length * 0.75);
        const p25 = sortedPrices[p25Index] || sortedPrices[0];
        const p75 = sortedPrices[p75Index] || sortedPrices[sortedPrices.length - 1];
        priceRange = {
          min: Math.floor(p25 * 0.8),
          max: Math.ceil(p75 * 1.2),
        };
      }

      return {
        preferredCategories: categoryData.map((c) => c._id).filter(Boolean),
        preferredBrands: brandData.map((b) => b._id).filter(Boolean),
        preferredPriceRange: priceRange,
        preferredStyles: [], // TODO: Extract from search queries and product tags
        searchPatterns: searchData.map((s) => s._id).filter(Boolean),
        engagementScore: engagementData[0]?.score || 0,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to get aggregated behavior: ${err.message}`, err.stack);
      // Return defaults on error
      return {
        preferredCategories: [],
        preferredBrands: [],
        preferredPriceRange: { min: 0, max: 500 },
        preferredStyles: [],
        searchPatterns: [],
        engagementScore: 0,
      };
    }
  }

  /**
   * Anonymize user events (for GDPR compliance)
   */
  async anonymizeUserEvents(userId: string): Promise<number> {
    try {
      const result = await this.eventModel.updateMany(
        { userId: new Types.ObjectId(userId) },
        {
          $set: {
            isAnonymized: true,
            userSnapshot: null,
            'context.sessionId': null,
          },
          $unset: {
            'searchData.query': '',
          },
        },
      );

      this.logger.log(`Anonymized ${result.modifiedCount} events for user ${userId}`);
      return result.modifiedCount;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to anonymize events: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Delete all user events (for GDPR compliance)
   */
  async deleteUserEvents(userId: string): Promise<number> {
    try {
      const result = await this.eventModel.deleteMany({
        userId: new Types.ObjectId(userId),
      });

      this.logger.log(`Deleted ${result.deletedCount} events for user ${userId}`);
      return result.deletedCount;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to delete events: ${err.message}`, err.stack);
      throw error;
    }
  }
}
