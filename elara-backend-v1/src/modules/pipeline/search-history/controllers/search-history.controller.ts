import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Request,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Roles } from '../../../auth/application/decorators/roles.decorator';
import {
  SearchHistoryRepository,
  SaveSearchParams,
} from '../infrastructure/persistence/search-history.repository';

/**
 * Search History Controller
 *
 * REST API endpoints for managing search history.
 *
 * User Endpoints:
 * - GET /search-history - Get recent searches
 * - GET /search-history/suggestions - Get search suggestions
 * - GET /search-history/analytics - Get user search analytics
 * - POST /search-history - Save a search
 * - POST /search-history/:searchId/interaction - Update interaction
 * - DELETE /search-history/:searchId - Delete a search
 * - DELETE /search-history - Clear all history
 *
 * Admin Endpoints:
 * - GET /search-history/trending - Get trending searches
 * - GET /search-history/global-analytics - Get global analytics
 */

// DTOs
interface SaveSearchDto {
  query: string;
  sessionId?: string;
  conversationId?: string;
  source?: string;
  filters?: {
    categories?: string[];
    brands?: string[];
    minPrice?: number;
    maxPrice?: number;
    colors?: string[];
    sizes?: string[];
  };
  results?: {
    totalFound?: number;
    resultsShown?: number;
    processingTimeMs?: number;
    sources?: string[];
  };
  detectedIntent?: string;
  intentConfidence?: number;
}

interface UpdateInteractionDto {
  clickedResults?: number;
  savedProducts?: number;
  clickedProductIds?: string[];
  interactionTimeMs?: number;
  refinedQuery?: string;
}

interface GetSuggestionsQueryDto {
  prefix?: string;
  limit?: string;
}

interface GetAnalyticsQueryDto {
  days?: string;
}

interface GetTrendingQueryDto {
  hours?: string;
  limit?: string;
}

@Controller('pipeline/search-history')
export class SearchHistoryController {
  private readonly logger = new Logger(SearchHistoryController.name);

  constructor(private searchHistoryRepository: SearchHistoryRepository) {}

  /**
   * Get recent searches for the user
   */
  @Get()
  async getRecentSearches(
    @Request() req: any,
    @Query('limit') limit?: string,
  ) {
    const userId = req.user.id;
    const searches = await this.searchHistoryRepository.getRecentSearches(
      userId,
      limit ? parseInt(limit, 10) : 10,
    );

    return {
      success: true,
      data: searches,
    };
  }

  /**
   * Get search suggestions for autocomplete
   */
  @Get('suggestions')
  async getSuggestions(
    @Request() req: any,
    @Query() query: GetSuggestionsQueryDto,
  ) {
    const userId = req.user.id;
    const suggestions = await this.searchHistoryRepository.getSearchSuggestions(
      userId,
      query.prefix,
      query.limit ? parseInt(query.limit, 10) : 10,
    );

    return {
      success: true,
      data: suggestions,
    };
  }

  /**
   * Get user search analytics
   */
  @Get('analytics')
  async getUserAnalytics(
    @Request() req: any,
    @Query() query: GetAnalyticsQueryDto,
  ) {
    const userId = req.user.id;
    const analytics = await this.searchHistoryRepository.getUserAnalytics(
      userId,
      query.days ? parseInt(query.days, 10) : 30,
    );

    return {
      success: true,
      data: analytics,
    };
  }

  /**
   * Get trending searches (admin only)
   */
  @Get('trending')
  @Roles('admin')
  async getTrending(@Query() query: GetTrendingQueryDto) {
    const trending = await this.searchHistoryRepository.getTrendingSearches(
      query.hours ? parseInt(query.hours, 10) : 24,
      query.limit ? parseInt(query.limit, 10) : 10,
    );

    return {
      success: true,
      data: trending,
    };
  }

  /**
   * Get global search analytics (admin only)
   */
  @Get('global-analytics')
  @Roles('admin')
  async getGlobalAnalytics(@Query() query: GetAnalyticsQueryDto) {
    const analytics = await this.searchHistoryRepository.getGlobalAnalytics(
      query.days ? parseInt(query.days, 10) : 7,
    );

    return {
      success: true,
      data: analytics,
    };
  }

  /**
   * Save a search to history
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async saveSearch(@Request() req: any, @Body() dto: SaveSearchDto) {
    const userId = req.user.id;

    const params: SaveSearchParams = {
      userId,
      query: dto.query,
      sessionId: dto.sessionId,
      conversationId: dto.conversationId,
      source: dto.source || 'api',
      filters: dto.filters,
      results: dto.results,
      detectedIntent: dto.detectedIntent,
      intentConfidence: dto.intentConfidence,
    };

    const search = await this.searchHistoryRepository.saveSearch(params);

    this.logger.debug(`Saved search: "${dto.query}" for user ${userId}`);

    return {
      success: true,
      data: {
        id: search._id,
        query: search.query,
        searchedAt: search.searchedAt,
      },
    };
  }

  /**
   * Update search interaction
   */
  @Post(':searchId/interaction')
  @HttpCode(HttpStatus.OK)
  async updateInteraction(
    @Param('searchId') searchId: string,
    @Body() dto: UpdateInteractionDto,
  ) {
    const updated = await this.searchHistoryRepository.updateInteraction(
      searchId,
      dto,
    );

    if (!updated) {
      return {
        success: false,
        message: 'Search not found',
      };
    }

    return {
      success: true,
      message: 'Interaction updated',
    };
  }

  /**
   * Delete a search from history
   */
  @Delete(':searchId')
  @HttpCode(HttpStatus.OK)
  async deleteSearch(
    @Request() req: any,
    @Param('searchId') searchId: string,
  ) {
    const userId = req.user.id;
    const deleted = await this.searchHistoryRepository.deleteSearch(
      userId,
      searchId,
    );

    if (!deleted) {
      return {
        success: false,
        message: 'Search not found',
      };
    }

    return {
      success: true,
      message: 'Search deleted',
    };
  }

  /**
   * Clear all search history
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  async clearHistory(@Request() req: any) {
    const userId = req.user.id;
    const count = await this.searchHistoryRepository.clearHistory(userId);

    this.logger.log(`Cleared ${count} searches for user ${userId}`);

    return {
      success: true,
      message: `Cleared ${count} searches`,
      data: { deletedCount: count },
    };
  }
}
