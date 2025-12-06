import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subscriber } from 'rxjs';
import {
  IChatHandler,
  ChatChunk,
  ChatIntent,
  UserContext,
} from '../handler.interface';
import { ConversationContext } from '../../../pipeline/agents/dto/chat-message.dto';
import { SearchFilters } from '../../../pipeline/search/dto/search-query.dto';
import {
  ContextAwareSearchService,
  ContextSearchResult,
} from '../../../pipeline/context/services/context-aware-search.service';

/**
 * Single Item Handler
 *
 * Handles single product search requests with full context awareness.
 * Considers weather, occasion, user preferences, and trends.
 *
 * Features:
 * - Weather-appropriate material filtering
 * - Occasion-based search enhancement
 * - User color and style preference matching
 * - Trend-boosted product ranking
 *
 * Examples:
 * - "Find me a black dress" → Considers occasion and weather
 * - "Show me Nike sneakers under $100" → Respects budget and brand preferences
 * - "I need a casual summer top" → Filters for warm weather materials
 */
@Injectable()
export class SingleItemHandler implements IChatHandler {
  private readonly logger = new Logger(SingleItemHandler.name);

  constructor(
    private contextAwareSearchService: ContextAwareSearchService,
  ) {}

  canHandle(intent: ChatIntent): boolean {
    return (
      intent === ChatIntent.SINGLE_ITEM_SEARCH ||
      intent === ChatIntent.CONTEXTUAL_ITEM_SEARCH
    );
  }

  handle(
    message: string,
    context: ConversationContext,
    filters?: SearchFilters,
    userContext?: UserContext,
  ): Observable<ChatChunk> {
    return new Observable((observer) => {
      this.executeSearch(message, context, filters, userContext, observer);
    });
  }

  private async executeSearch(
    message: string,
    context: ConversationContext,
    filters: SearchFilters | undefined,
    userContext: UserContext | undefined,
    observer: Subscriber<ChatChunk>,
  ): Promise<void> {
    try {
      // Get user ID
      const userId = userContext?.userId || context.userId || 'anonymous';

      // Step 1: Emit status - preparing context
      observer.next({
        type: 'status',
        status: 'preparing',
        text: 'Preparing personalized search...',
      });

      // Step 2: Execute context-aware search
      observer.next({
        type: 'status',
        status: 'searching',
        text: 'Searching for products...',
      });

      this.logger.log(`Context-aware search for user ${userId}: "${message}"`);

      const searchResult = await this.contextAwareSearchService.search({
        userId,
        query: message,
        filters: {
          occasion: filters?.occasion,
          location: userContext?.location || userContext?.profile?.location?.city,
          itemType: filters?.itemType,
          color: filters?.color,
          style: filters?.style,
          priceRange: filters?.priceRange,
          brands: filters?.brand,
        },
        limit: 20,
        boostTrending: true,
        respectConstraints: true,
      });

      // Step 3: Handle no results
      if (searchResult.products.length === 0) {
        observer.next({
          type: 'text',
          text: "I couldn't find any products matching your search. Would you like to try different criteria?",
        });
        observer.next({
          type: 'data',
          data: {
            products: [],
            query: message,
            context: searchResult.context,
          },
          done: true,
        });
        observer.complete();
        return;
      }

      // Step 4: Generate contextual response
      const responseText = this.generateContextualResponse(searchResult, message);

      observer.next({
        type: 'text',
        text: responseText,
      });

      // Step 5: Send final data with context
      observer.next({
        type: 'data',
        data: {
          products: searchResult.products,
          totalFound: searchResult.totalFound,
          query: message,
          enhancedQuery: searchResult.context.enhancedQuery,
          filters: filters,
          context: {
            weather: searchResult.context.weather,
            constraints: searchResult.context.constraints,
            trends: searchResult.context.appliedTrends?.map(t => t.name),
          },
          sources: searchResult.sources,
          timing: searchResult.timing,
        },
        done: true,
      });

      this.logger.log(
        `Context-aware search completed: ${searchResult.products.length} products in ${searchResult.timing.total}ms`,
      );

      observer.complete();
    } catch (error) {
      this.logger.error(`Search failed: ${(error as Error).message}`);
      observer.next({
        type: 'text',
        text: "I'm having trouble searching right now. Please try again.",
      });
      observer.error(error);
    }
  }

  private generateContextualResponse(result: ContextSearchResult, query: string): string {
    const count = result.products.length;

    if (count === 0) {
      return "I couldn't find any products matching your criteria.";
    }

    // Build contextual message parts
    const parts: string[] = [];

    // Main count message
    if (count === 1) {
      parts.push(`I found 1 item for you`);
    } else if (count <= 5) {
      parts.push(`I found ${count} items for you`);
    } else {
      parts.push(`I found ${count} items`);
    }

    // Add context details
    const contextDetails: string[] = [];

    if (result.context.weather) {
      const temp = result.context.weather.temperature;
      const condition = result.context.weather.condition;
      if (temp <= 50 || temp >= 80 || ['rainy', 'snowy'].includes(condition)) {
        contextDetails.push(`suitable for ${temp}°F ${condition} weather`);
      }
    }

    if (result.context.appliedTrends && result.context.appliedTrends.length > 0) {
      const topTrend = result.context.appliedTrends[0];
      if (topTrend.relevanceScore > 0.8) {
        contextDetails.push(`featuring the ${topTrend.name} trend`);
      }
    }

    if (contextDetails.length > 0) {
      parts.push(` — ${contextDetails.join(', ')}`);
    }

    parts.push(':');

    return parts.join('');
  }
}
