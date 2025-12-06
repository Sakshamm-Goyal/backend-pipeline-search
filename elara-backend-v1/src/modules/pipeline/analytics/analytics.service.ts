import { Injectable, Logger } from '@nestjs/common';
import { UserEventRepository, TrackEventParams } from './infrastructure/persistence/user-event.repository';
import { EventType, EventContext } from './domain/schemas/user-event.schema';

/**
 * Analytics Service
 *
 * High-level API for tracking user behavior and retrieving analytics data.
 * All tracking methods are non-blocking (fire and forget).
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private eventRepository: UserEventRepository) {}

  // ===================
  // Search Events
  // ===================

  /**
   * Track a search query
   */
  trackSearch(
    userId: string,
    query: string,
    resultCount: number,
    filters?: Record<string, any>,
    sources?: string[],
    processingTime?: number,
    context?: Partial<EventContext>,
  ): void {
    this.track({
      userId,
      eventType: EventType.SEARCH,
      searchData: {
        query,
        resultCount,
        filters,
        sources,
        processingTime,
      },
      context,
    });
  }

  /**
   * Track clicking on a search result
   */
  trackSearchClick(
    userId: string,
    query: string,
    productId: string,
    position: number,
    context?: Partial<EventContext>,
  ): void {
    this.track({
      userId,
      eventType: EventType.SEARCH_CLICK,
      searchData: { query, position },
      productData: { productId },
      context,
    });
  }

  // ===================
  // Product Events
  // ===================

  /**
   * Track viewing a product
   */
  trackProductView(
    userId: string,
    product: {
      productId: string;
      externalId?: string;
      category?: string;
      brand?: string;
      price?: number;
      source?: string;
    },
    position?: number,
    context?: Partial<EventContext>,
  ): void {
    this.track({
      userId,
      eventType: EventType.PRODUCT_VIEW,
      productData: {
        ...product,
        position,
      },
      context,
    });
  }

  /**
   * Track clicking through to retailer
   */
  trackProductClick(
    userId: string,
    product: {
      productId: string;
      externalId?: string;
      category?: string;
      brand?: string;
      price?: number;
      source?: string;
    },
    context?: Partial<EventContext>,
  ): void {
    this.track({
      userId,
      eventType: EventType.PRODUCT_CLICK,
      productData: product,
      context,
    });
  }

  /**
   * Track saving a product to wishlist
   */
  trackProductSave(
    userId: string,
    product: {
      productId: string;
      externalId?: string;
      category?: string;
      brand?: string;
      price?: number;
    },
    context?: Partial<EventContext>,
  ): void {
    this.track({
      userId,
      eventType: EventType.PRODUCT_SAVE,
      productData: product,
      context,
    });
  }

  /**
   * Track removing a product from wishlist
   */
  trackProductUnsave(
    userId: string,
    productId: string,
    context?: Partial<EventContext>,
  ): void {
    this.track({
      userId,
      eventType: EventType.PRODUCT_UNSAVE,
      productData: { productId },
      context,
    });
  }

  // ===================
  // Wardrobe Events
  // ===================

  /**
   * Track adding item to wardrobe
   */
  trackWardrobeAdd(
    userId: string,
    itemId: string,
    category: string,
    context?: Partial<EventContext>,
  ): void {
    this.track({
      userId,
      eventType: EventType.WARDROBE_ADD,
      wardrobeData: { itemId, category },
      context,
    });
  }

  /**
   * Track removing item from wardrobe
   */
  trackWardrobeRemove(
    userId: string,
    itemId: string,
    context?: Partial<EventContext>,
  ): void {
    this.track({
      userId,
      eventType: EventType.WARDROBE_REMOVE,
      wardrobeData: { itemId },
      context,
    });
  }

  // ===================
  // Outfit Events
  // ===================

  /**
   * Track creating an outfit
   */
  trackOutfitCreate(
    userId: string,
    outfitId: string,
    itemIds: string[],
    context?: Partial<EventContext>,
  ): void {
    this.track({
      userId,
      eventType: EventType.OUTFIT_CREATE,
      wardrobeData: { outfitId, itemIds },
      context,
    });
  }

  /**
   * Track saving/wearing an outfit
   */
  trackOutfitWear(
    userId: string,
    outfitId: string,
    itemIds: string[],
    context?: Partial<EventContext>,
  ): void {
    this.track({
      userId,
      eventType: EventType.OUTFIT_WEAR,
      wardrobeData: { outfitId, itemIds },
      context,
    });
  }

  // ===================
  // Chat Events
  // ===================

  /**
   * Track chat message sent
   */
  trackChatMessage(
    userId: string,
    messageId: string,
    intent?: string,
    agentUsed?: string,
    responseTime?: number,
    context?: Partial<EventContext>,
  ): void {
    this.track({
      userId,
      eventType: EventType.CHAT_MESSAGE,
      chatData: {
        messageId,
        intent,
        agentUsed,
        responseTime,
      },
      context,
    });
  }

  /**
   * Track chat feedback (thumbs up/down)
   */
  trackChatFeedback(
    userId: string,
    messageId: string,
    feedbackType: 'positive' | 'negative',
    context?: Partial<EventContext>,
  ): void {
    this.track({
      userId,
      eventType: EventType.CHAT_FEEDBACK,
      chatData: { messageId, feedbackType },
      context,
    });
  }

  // ===================
  // Session Events
  // ===================

  /**
   * Track session start
   */
  trackSessionStart(
    userId: string,
    sessionId: string,
    deviceType?: string,
    platform?: string,
  ): void {
    this.track({
      userId,
      eventType: EventType.SESSION_START,
      context: { sessionId, deviceType, platform },
    });
  }

  /**
   * Track session end
   */
  trackSessionEnd(
    userId: string,
    sessionId: string,
  ): void {
    this.track({
      userId,
      eventType: EventType.SESSION_END,
      context: { sessionId },
    });
  }

  // ===================
  // Analytics Queries
  // ===================

  /**
   * Get user statistics
   */
  async getUserStats(userId: string, days: number = 30) {
    return this.eventRepository.getUserStats(userId, days);
  }

  /**
   * Get aggregated user behavior for personalization
   */
  async getUserBehavior(userId: string, days: number = 90) {
    return this.eventRepository.getAggregatedBehavior(userId, days);
  }

  /**
   * Get recent user events
   */
  async getRecentEvents(
    userId: string,
    eventTypes?: EventType[],
    limit: number = 50,
  ) {
    return this.eventRepository.getUserEvents(userId, {
      eventTypes,
      limit,
    });
  }

  // ===================
  // GDPR Compliance
  // ===================

  /**
   * Anonymize all user events
   */
  async anonymizeUser(userId: string): Promise<number> {
    return this.eventRepository.anonymizeUserEvents(userId);
  }

  /**
   * Delete all user events
   */
  async deleteUserData(userId: string): Promise<number> {
    return this.eventRepository.deleteUserEvents(userId);
  }

  // ===================
  // Private Helpers
  // ===================

  /**
   * Non-blocking event tracking
   */
  private track(params: TrackEventParams): void {
    // Fire and forget - don't await
    this.eventRepository.track(params).catch((err) => {
      this.logger.error(`Failed to track event: ${err.message}`);
    });
  }
}
