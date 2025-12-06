import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SearchHistory, SearchHistorySchema } from './domain/schemas/search-history.schema';
import { SearchHistoryRepository } from './infrastructure/persistence/search-history.repository';
import { SearchHistoryController } from './controllers/search-history.controller';

/**
 * Search History Module
 *
 * Provides search history tracking and analytics.
 *
 * Features:
 * - Recent searches
 * - Search suggestions/autocomplete
 * - User search analytics
 * - Global trending searches
 * - Search interaction tracking
 *
 * API Endpoints:
 * - GET /pipeline/search-history - Get recent searches
 * - GET /pipeline/search-history/suggestions - Get autocomplete suggestions
 * - GET /pipeline/search-history/analytics - Get user analytics
 * - GET /pipeline/search-history/trending - Get trending (admin)
 * - GET /pipeline/search-history/global-analytics - Get global stats (admin)
 * - POST /pipeline/search-history - Save search
 * - POST /pipeline/search-history/:searchId/interaction - Update interaction
 * - DELETE /pipeline/search-history/:searchId - Delete search
 * - DELETE /pipeline/search-history - Clear all history
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SearchHistory.name, schema: SearchHistorySchema },
    ]),
  ],
  controllers: [SearchHistoryController],
  providers: [SearchHistoryRepository],
  exports: [SearchHistoryRepository],
})
export class SearchHistoryModule {}
