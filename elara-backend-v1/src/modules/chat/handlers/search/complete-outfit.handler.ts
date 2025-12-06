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
  OutfitReasoningService,
  GeneratedOutfit,
  OutfitGenerationResult,
} from '../../../pipeline/outfit-scoring/services/outfit-reasoning.service';

/**
 * Complete Outfit Handler
 *
 * Creates complete outfit recommendations using the context-aware OutfitReasoningService.
 *
 * Features:
 * - Full context awareness (weather, event, user preferences, trends)
 * - Wardrobe integration for synergy suggestions
 * - Constraint validation (budget, coverage, materials)
 * - Trend alignment scoring
 *
 * Examples:
 * - "Create an outfit for a summer wedding"
 * - "What should I wear to a job interview?"
 * - "Build me a casual weekend look"
 */
@Injectable()
export class CompleteOutfitHandler implements IChatHandler {
  private readonly logger = new Logger(CompleteOutfitHandler.name);

  constructor(
    private outfitReasoningService: OutfitReasoningService,
  ) {}

  canHandle(intent: ChatIntent): boolean {
    return intent === ChatIntent.COMPLETE_OUTFIT_SEARCH;
  }

  handle(
    message: string,
    context: ConversationContext,
    filters?: SearchFilters,
    userContext?: UserContext,
  ): Observable<ChatChunk> {
    return new Observable((observer) => {
      this.executeOutfitGeneration(message, context, filters, userContext, observer);
    });
  }

  private async executeOutfitGeneration(
    message: string,
    context: ConversationContext,
    filters: SearchFilters | undefined,
    userContext: UserContext | undefined,
    observer: Subscriber<ChatChunk>,
  ): Promise<void> {
    try {
      // Step 1: Analyzing request and preparing context
      observer.next({
        type: 'status',
        status: 'analyzing',
        text: 'Analyzing your style request and preparing context...',
      });

      // Get user ID from context
      const userId = userContext?.userId || context.userId || 'anonymous';

      // Step 2: Generating context-aware outfits
      observer.next({
        type: 'status',
        status: 'creating',
        text: 'Creating personalized outfit combinations...',
      });

      const result = await this.outfitReasoningService.generateOutfits({
        userId,
        query: message,
        filters: {
          occasion: filters?.occasion,
          location: userContext?.location || userContext?.profile?.location?.city,
          datetime: new Date(),
          color: filters?.color,
          style: filters?.style,
          priceRange: filters?.priceRange,
          brands: filters?.brand,
        },
        count: 3,
      });

      // Check if we got any outfits
      if (result.outfits.length === 0) {
        observer.next({
          type: 'text',
          text: "I couldn't find enough products to create complete outfits. Try adjusting your search criteria.",
        });
        observer.next({
          type: 'data',
          data: {
            outfits: [],
            query: message,
            context: result.context,
          },
          done: true,
        });
        observer.complete();
        return;
      }

      // Step 3: Format and send outfits
      const formattedOutfits = result.outfits.map((outfit, index) =>
        this.formatOutfit(outfit, index),
      );

      // Generate contextual message
      const outfitMessage = this.generateOutfitMessage(
        formattedOutfits.length,
        result.context,
      );

      observer.next({
        type: 'text',
        text: outfitMessage,
      });

      observer.next({
        type: 'data',
        data: {
          outfits: formattedOutfits,
          query: message,
          context: {
            weather: result.context.weather,
            event: result.context.event,
            trends: result.context.appliedTrends?.map(t => t.name),
          },
          timing: {
            total: result.metadata.processingTimeMs,
          },
        },
        done: true,
      });

      this.logger.log(
        `Generated ${formattedOutfits.length} context-aware outfits in ${result.metadata.processingTimeMs}ms`,
      );

      observer.complete();
    } catch (error) {
      this.logger.error(`Outfit generation failed: ${(error as Error).message}`);
      observer.next({
        type: 'text',
        text: "I'm having trouble creating outfits right now. Please try again in a moment.",
      });
      observer.error(error);
    }
  }

  private formatOutfit(outfit: GeneratedOutfit, index: number): any {
    const items = outfit.items.map((item) => {
      if (item.product) {
        return {
          category: item.slot,
          name: item.product.title,
          price: `$${item.product.price?.toFixed(2) || '0.00'}`,
          url: item.product.productUrl,
          image_url: item.product.imageUrl,
          retailer: item.product.retailer,
          product_id: item.product.id,
          brand: item.product.brand,
          selectionReason: item.selectionReason,
          isFromWardrobe: item.isFromWardrobe,
        };
      }

      if (item.wardrobeItem) {
        return {
          category: item.slot,
          name: item.wardrobeItem.name,
          price: 'From your wardrobe',
          url: '',
          image_url: item.wardrobeItem.imageUrl,
          retailer: 'Your Wardrobe',
          product_id: item.wardrobeItem.id,
          brand: item.wardrobeItem.brand,
          selectionReason: item.selectionReason,
          isFromWardrobe: true,
        };
      }

      return {
        category: item.slot,
        name: item.productId,
        price: 'Price unavailable',
        url: '',
        image_url: '',
        retailer: 'Unknown',
        product_id: item.productId,
        selectionReason: item.selectionReason,
        isFromWardrobe: false,
      };
    });

    return {
      outfit_id: index + 1,
      name: outfit.name,
      items,
      total_price: `$${outfit.totalPrice.toFixed(2)}`,
      reasoning: outfit.styleNotes || outfit.occasionFit,
      style: outfit.style,
      colorScheme: outfit.colorScheme,
      wardrobeSynergy: outfit.wardrobeSynergy,
      weatherFit: outfit.weatherFit,
      trendAlignment: outfit.trendAlignment,
      score: outfit.score,
      constraintValidation: outfit.constraintValidation,
    };
  }

  private generateOutfitMessage(
    count: number,
    context: OutfitGenerationResult['context'],
  ): string {
    let message = '';

    if (count === 0) {
      return "I couldn't create any outfits with the available products.";
    } else if (count === 1) {
      message = "I've created a complete outfit for you";
    } else if (count === 2) {
      message = "I've created 2 outfit options for you";
    } else {
      message = `I've created ${count} outfit combinations for you`;
    }

    // Add context details
    const details: string[] = [];

    if (context.weather) {
      details.push(`${context.weather.temperature}°F ${context.weather.condition}`);
    }

    if (context.event) {
      details.push(`${context.event.formality} ${context.event.occasion}`);
    }

    if (context.appliedTrends && context.appliedTrends.length > 0) {
      details.push(`incorporating ${context.appliedTrends[0].name} trend`);
    }

    if (details.length > 0) {
      message += ` — perfect for ${details.join(', ')}!`;
    } else {
      message += '!';
    }

    return message;
  }
}
