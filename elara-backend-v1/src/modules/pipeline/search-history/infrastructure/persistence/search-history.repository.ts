import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SearchHistory,
  SearchFilters,
  SearchResultsSummary,
  SearchInteraction,
} from '../../domain/schemas/search-history.schema';

/**
 * Search History Repository
 *
 * Handles search history persistence and analytics queries.
 */

export interface SaveSearchParams {
  userId: string;
  query: string;
  sessionId?: string;
  conversationId?: string;
  source?: string;
  filters?: Partial<SearchFilters>;
  results?: Partial<SearchResultsSummary>;
  detectedIntent?: string;
  intentConfidence?: number;
}

export interface SearchSuggestion {
  query: string;
  count: number;
  lastSearched: Date;
}

export interface SearchAnalytics {
  totalSearches: number;
  uniqueQueries: number;
  avgResultsFound: number;
  avgProcessingTime: number;
  topQueries: Array<{ query: string; count: number }>;
  topCategories: Array<{ category: string; count: number }>;
  topBrands: Array<{ brand: string; count: number }>;
  searchesBySource: Record<string, number>;
  searchesByDay: Array<{ date: string; count: number }>;
}

@Injectable()
export class SearchHistoryRepository {
  private readonly logger = new Logger(SearchHistoryRepository.name);

  constructor(
    @InjectModel(SearchHistory.name)
    private searchHistoryModel: Model<SearchHistory>,
  ) {}

  /**
   * Save a search to history
   */
  async saveSearch(params: SaveSearchParams): Promise<SearchHistory> {
    try {
      const normalizedQuery = this.normalizeQuery(params.query);

      const search = new this.searchHistoryModel({
        userId: new Types.ObjectId(params.userId),
        query: params.query,
        normalizedQuery,
        sessionId: params.sessionId,
        conversationId: params.conversationId,
        source: params.source,
        filters: params.filters,
        results: params.results,
        detectedIntent: params.detectedIntent,
        intentConfidence: params.intentConfidence,
        searchedAt: new Date(),
      });

      await search.save();
      this.logger.debug(`Saved search: "${params.query}" for user ${params.userId}`);
      return search;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error saving search: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Update search interaction (when user clicks/saves from results)
   */
  async updateInteraction(
    searchId: string,
    interaction: Partial<SearchInteraction>,
  ): Promise<boolean> {
    try {
      const result = await this.searchHistoryModel.updateOne(
        { _id: new Types.ObjectId(searchId) },
        {
          $set: {
            'interaction.clickedResults': interaction.clickedResults,
            'interaction.savedProducts': interaction.savedProducts,
            'interaction.interactionTimeMs': interaction.interactionTimeMs,
            'interaction.refinedQuery': interaction.refinedQuery,
          },
          $addToSet: {
            'interaction.clickedProductIds': {
              $each: interaction.clickedProductIds || [],
            },
          },
        },
      );

      return result.modifiedCount > 0;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error updating interaction: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get recent searches for a user
   */
  async getRecentSearches(
    userId: string,
    limit: number = 10,
  ): Promise<SearchHistory[]> {
    try {
      return await this.searchHistoryModel
        .find({
          userId: new Types.ObjectId(userId),
          isDeleted: false,
        })
        .sort({ searchedAt: -1 })
        .limit(limit);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting recent searches: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get unique recent queries for autocomplete
   */
  async getSearchSuggestions(
    userId: string,
    prefix?: string,
    limit: number = 10,
  ): Promise<SearchSuggestion[]> {
    try {
      const matchStage: any = {
        userId: new Types.ObjectId(userId),
        isDeleted: false,
      };

      if (prefix) {
        matchStage.normalizedQuery = { $regex: `^${this.escapeRegex(prefix.toLowerCase())}` };
      }

      const results = await this.searchHistoryModel.aggregate([
        { $match: matchStage },
        { $sort: { searchedAt: -1 } },
        {
          $group: {
            _id: '$normalizedQuery',
            query: { $first: '$query' },
            count: { $sum: 1 },
            lastSearched: { $max: '$searchedAt' },
          },
        },
        { $sort: { count: -1, lastSearched: -1 } },
        { $limit: limit },
      ]);

      return results.map((r) => ({
        query: r.query,
        count: r.count,
        lastSearched: r.lastSearched,
      }));
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting suggestions: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get trending searches globally
   */
  async getTrendingSearches(
    hours: number = 24,
    limit: number = 10,
  ): Promise<Array<{ query: string; count: number }>> {
    try {
      const cutoff = new Date();
      cutoff.setHours(cutoff.getHours() - hours);

      const results = await this.searchHistoryModel.aggregate([
        {
          $match: {
            isDeleted: false,
            searchedAt: { $gte: cutoff },
          },
        },
        {
          $group: {
            _id: '$normalizedQuery',
            query: { $first: '$query' },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: limit },
      ]);

      return results.map((r) => ({ query: r.query, count: r.count }));
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting trending searches: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get search analytics for a user
   */
  async getUserAnalytics(
    userId: string,
    days: number = 30,
  ): Promise<SearchAnalytics> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);

      const matchStage = {
        userId: new Types.ObjectId(userId),
        isDeleted: false,
        searchedAt: { $gte: cutoff },
      };

      const [
        basicStats,
        topQueries,
        topCategories,
        topBrands,
        bySource,
        byDay,
      ] = await Promise.all([
        // Basic stats
        this.searchHistoryModel.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: null,
              totalSearches: { $sum: 1 },
              uniqueQueries: { $addToSet: '$normalizedQuery' },
              avgResults: { $avg: '$results.totalFound' },
              avgProcessingTime: { $avg: '$results.processingTimeMs' },
            },
          },
        ]),

        // Top queries
        this.searchHistoryModel.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: '$normalizedQuery',
              query: { $first: '$query' },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),

        // Top categories
        this.searchHistoryModel.aggregate([
          { $match: matchStage },
          { $unwind: '$filters.categories' },
          {
            $group: {
              _id: '$filters.categories',
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),

        // Top brands
        this.searchHistoryModel.aggregate([
          { $match: matchStage },
          { $unwind: '$filters.brands' },
          {
            $group: {
              _id: '$filters.brands',
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]),

        // By source
        this.searchHistoryModel.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: { $ifNull: ['$source', 'unknown'] },
              count: { $sum: 1 },
            },
          },
        ]),

        // By day
        this.searchHistoryModel.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$searchedAt' } },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
      ]);

      const stats = basicStats[0] || {
        totalSearches: 0,
        uniqueQueries: [],
        avgResults: 0,
        avgProcessingTime: 0,
      };

      return {
        totalSearches: stats.totalSearches,
        uniqueQueries: stats.uniqueQueries?.length || 0,
        avgResultsFound: Math.round(stats.avgResults || 0),
        avgProcessingTime: Math.round(stats.avgProcessingTime || 0),
        topQueries: topQueries.map((q) => ({ query: q.query, count: q.count })),
        topCategories: topCategories.map((c) => ({ category: c._id, count: c.count })),
        topBrands: topBrands.map((b) => ({ brand: b._id, count: b.count })),
        searchesBySource: bySource.reduce(
          (acc, s) => ({ ...acc, [s._id]: s.count }),
          {},
        ),
        searchesByDay: byDay.map((d) => ({ date: d._id, count: d.count })),
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting analytics: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get global search analytics (admin)
   */
  async getGlobalAnalytics(days: number = 7): Promise<SearchAnalytics> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);

      // Same as user analytics but without user filter
      const matchStage = {
        isDeleted: false,
        searchedAt: { $gte: cutoff },
      };

      const [basicStats, topQueries, bySource, byDay] = await Promise.all([
        this.searchHistoryModel.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: null,
              totalSearches: { $sum: 1 },
              uniqueQueries: { $addToSet: '$normalizedQuery' },
              uniqueUsers: { $addToSet: '$userId' },
              avgResults: { $avg: '$results.totalFound' },
              avgProcessingTime: { $avg: '$results.processingTimeMs' },
            },
          },
        ]),

        this.searchHistoryModel.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: '$normalizedQuery',
              query: { $first: '$query' },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 20 },
        ]),

        this.searchHistoryModel.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: { $ifNull: ['$source', 'unknown'] },
              count: { $sum: 1 },
            },
          },
        ]),

        this.searchHistoryModel.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$searchedAt' } },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
      ]);

      const stats = basicStats[0] || {
        totalSearches: 0,
        uniqueQueries: [],
        avgResults: 0,
        avgProcessingTime: 0,
      };

      return {
        totalSearches: stats.totalSearches,
        uniqueQueries: stats.uniqueQueries?.length || 0,
        avgResultsFound: Math.round(stats.avgResults || 0),
        avgProcessingTime: Math.round(stats.avgProcessingTime || 0),
        topQueries: topQueries.map((q) => ({ query: q.query, count: q.count })),
        topCategories: [],
        topBrands: [],
        searchesBySource: bySource.reduce(
          (acc, s) => ({ ...acc, [s._id]: s.count }),
          {},
        ),
        searchesByDay: byDay.map((d) => ({ date: d._id, count: d.count })),
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error getting global analytics: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Clear user search history
   */
  async clearHistory(userId: string): Promise<number> {
    try {
      const result = await this.searchHistoryModel.updateMany(
        { userId: new Types.ObjectId(userId) },
        { $set: { isDeleted: true, deletedAt: new Date() } },
      );

      this.logger.log(`Cleared ${result.modifiedCount} searches for user ${userId}`);
      return result.modifiedCount;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error clearing history: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Delete specific search from history
   */
  async deleteSearch(userId: string, searchId: string): Promise<boolean> {
    try {
      const result = await this.searchHistoryModel.updateOne(
        {
          _id: new Types.ObjectId(searchId),
          userId: new Types.ObjectId(userId),
        },
        { $set: { isDeleted: true, deletedAt: new Date() } },
      );

      return result.modifiedCount > 0;
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error deleting search: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Normalize query for grouping
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '');
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
