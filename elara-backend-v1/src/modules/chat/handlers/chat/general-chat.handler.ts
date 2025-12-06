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
import { GeminiService } from '../../../pipeline/infrastructure/llm/gemini.service';
import { ColorPairingService, ColorPairingResult } from '../../../pipeline/utilities/color-pairing.service';
import { ContextAwareSearchService } from '../../../pipeline/context/services/context-aware-search.service';

/**
 * General Chat Handler
 *
 * Handles general conversation, greetings, fashion advice,
 * and off-topic queries.
 *
 * Examples:
 * - "Hello!"
 * - "What colors go well together?"
 * - "How do I style a blazer?"
 * - "What's the weather like?" (off-topic)
 */
@Injectable()
export class GeneralChatHandler implements IChatHandler {
  private readonly logger = new Logger(GeneralChatHandler.name);

  constructor(
    private geminiService: GeminiService,
    private colorPairingService: ColorPairingService,
    private contextAwareSearchService: ContextAwareSearchService,
  ) {}

  canHandle(intent: ChatIntent): boolean {
    return (
      intent === ChatIntent.GENERAL_CHAT ||
      intent === ChatIntent.FASHION_ADVICE ||
      intent === ChatIntent.OFF_TOPIC
    );
  }

  handle(
    message: string,
    context: ConversationContext,
    filters?: SearchFilters,
    userContext?: UserContext,
  ): Observable<ChatChunk> {
    return new Observable((observer) => {
      this.processChat(message, context, filters, userContext, observer);
    });
  }

  private async processChat(
    message: string,
    context: ConversationContext,
    filters: SearchFilters | undefined,
    userContext: UserContext | undefined,
    observer: Subscriber<ChatChunk>,
  ): Promise<void> {
    try {
      const messageLower = message.toLowerCase().trim();

      // Check for off-topic
      if (this.isOffTopic(messageLower)) {
        const response = this.generateOffTopicResponse(message);
        observer.next({ type: 'text', text: response });
        observer.next({
          type: 'data',
          data: {
            isOffTopic: true,
            suggestedActions: [
              { label: 'Search for clothes', action: 'start_search' },
              { label: 'Get outfit ideas', action: 'create_outfit' },
              { label: 'Get styling advice', action: 'fashion_advice' },
            ],
          },
          done: true,
        });
        observer.complete();
        return;
      }

      // Check for greeting
      if (this.isGreeting(messageLower)) {
        const response = this.generateGreetingResponse(userContext);
        observer.next({ type: 'text', text: response });
        observer.next({
          type: 'data',
          data: {
            isGreeting: true,
            suggestedActions: [
              { label: 'Find an outfit', action: 'create_outfit' },
              { label: 'Browse products', action: 'start_search' },
              { label: 'Get styling tips', action: 'fashion_advice' },
            ],
          },
          done: true,
        });
        observer.complete();
        return;
      }

      // Check for color pairing query (e.g., "what goes with olive skirt")
      const colorPairingIntent = this.colorPairingService.detectColorPairingIntent(message);
      if (colorPairingIntent.isPairingQuery && colorPairingIntent.existingColor) {
        this.logger.log(
          `COLOR PAIRING QUERY DETECTED: "${message}" - color: ${colorPairingIntent.existingColor}, item: ${colorPairingIntent.itemType || 'unknown'}`,
        );
        await this.handleColorPairingQuery(message, colorPairingIntent, context, userContext, observer);
        return;
      }

      // Check for fashion advice
      if (this.isFashionAdvice(messageLower)) {
        await this.generateFashionAdvice(message, userContext, observer);
        return;
      }

      // Default: use Gemini for general chat
      await this.generateChatResponse(message, context, userContext, observer);
    } catch (error) {
      this.logger.error(`Chat processing failed: ${(error as Error).message}`);
      observer.next({
        type: 'text',
        text: this.generateFallbackResponse(message),
      });
      observer.next({ type: 'data', data: {}, done: true });
      observer.complete();
    }
  }

  private isGreeting(message: string): boolean {
    const greetings = [
      'hi', 'hello', 'hey', 'good morning', 'good afternoon',
      'good evening', "what's up", 'howdy', 'hola',
    ];
    return greetings.some((g) => message.startsWith(g) || message === g);
  }

  private isOffTopic(message: string): boolean {
    const offTopicKeywords = [
      // Tech
      'api', 'code', 'programming', 'software', 'database',
      'algorithm', 'machine learning', 'bitcoin', 'crypto',
      // Other
      'recipe', 'cooking', 'restaurant', 'hotel', 'flight',
      'movie', 'song', 'game', 'stock', 'invest', 'medical',
      'doctor', 'politics', 'election', 'math', 'physics',
    ];

    const fashionKeywords = [
      'wear', 'outfit', 'dress', 'shirt', 'pants', 'shoes',
      'style', 'fashion', 'clothes', 'accessory', 'look',
      'color', 'match', 'fit', 'size', 'brand', 'shop',
    ];

    const hasOffTopic = offTopicKeywords.some((kw) => message.includes(kw));
    const hasFashion = fashionKeywords.some((kw) => message.includes(kw));

    return hasOffTopic && !hasFashion;
  }

  private isFashionAdvice(message: string): boolean {
    const adviceKeywords = [
      'how to style', 'how do i style', 'what goes with',
      'what color', 'how to wear', 'what should i wear',
      'styling tips', 'fashion advice', 'match with',
      'pair with', 'combine with', 'look good with',
    ];
    return adviceKeywords.some((kw) => message.includes(kw));
  }

  private generateGreetingResponse(userContext?: UserContext): string {
    const name = userContext?.profile?.gender === 'female' ? 'stylish' : 'fashion-forward';

    const responses = [
      `Hi there! I'm Elara, your personal fashion assistant. What can I help you find today?`,
      `Hello! Ready to discover some amazing fashion? Tell me what you're looking for!`,
      `Hey! Great to see you! Looking for a complete outfit or something specific?`,
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  }

  private generateOffTopicResponse(message: string): string {
    const messageLower = message.toLowerCase();

    if (messageLower.includes('code') || messageLower.includes('api') || messageLower.includes('programming')) {
      return "I'm Elara, your personal fashion assistant! While I can't help with tech questions, I'm an expert at helping you find the perfect outfit. What can I help you with today?";
    }

    if (messageLower.includes('food') || messageLower.includes('recipe') || messageLower.includes('restaurant')) {
      return "I'm all about clothes and style rather than food! But I'd love to help you pick an outfit - maybe something for a dinner date? What occasion are you dressing for?";
    }

    return "I'm Elara, your AI fashion assistant! I specialize in helping you discover clothes, create outfits, and develop your personal style. What fashion help can I provide?";
  }

  private async generateFashionAdvice(
    message: string,
    userContext: UserContext | undefined,
    observer: Subscriber<ChatChunk>,
  ): Promise<void> {
    const profile = userContext?.profile || {};

    const prompt = `You are Elara, an expert fashion stylist. Give specific, actionable advice.

USER PROFILE:
- Gender: ${profile.gender || 'not specified'}
- Style: ${profile.primaryStyle || 'versatile'}
- Preferred Colors: ${profile.colorPreferences?.join(', ') || 'open to all'}
- Colors to Avoid: ${profile.avoidColors?.join(', ') || 'none'}

QUESTION: "${message}"

Give concise (3-4 sentences) fashion advice. Be warm but professional.`;

    try {
      const response = await this.geminiService.generateChatResponse(prompt, [], userContext);

      observer.next({ type: 'text', text: response });
      observer.next({
        type: 'data',
        data: {
          isFashionAdvice: true,
          suggestedActions: [
            { label: 'Show me products', action: 'start_search' },
            { label: 'Create an outfit', action: 'create_outfit' },
          ],
        },
        done: true,
      });
      observer.complete();
    } catch (error) {
      observer.next({
        type: 'text',
        text: this.generateFallbackFashionAdvice(message),
      });
      observer.next({ type: 'data', data: {}, done: true });
      observer.complete();
    }
  }

  private async generateChatResponse(
    message: string,
    context: ConversationContext,
    userContext: UserContext | undefined,
    observer: Subscriber<ChatChunk>,
  ): Promise<void> {
    try {
      const response = await this.geminiService.generateChatResponse(
        message,
        context.history.slice(-5).map((h) => ({
          role: h.role,
          content: h.content,
        })),
        userContext,
      );

      observer.next({ type: 'text', text: response });
      observer.next({
        type: 'data',
        data: {
          suggestedActions: [
            { label: 'Search for products', action: 'start_search' },
            { label: 'Build an outfit', action: 'create_outfit' },
          ],
        },
        done: true,
      });
      observer.complete();
    } catch (error) {
      throw error;
    }
  }

  private generateFallbackResponse(message: string): string {
    return "I'm here to help you find great fashion! You can ask me to search for specific items, create outfits for occasions, or just chat about style. What would you like to do?";
  }

  private generateFallbackFashionAdvice(message: string): string {
    const messageLower = message.toLowerCase();

    if (messageLower.includes('color')) {
      return "When combining colors, consider the color wheel: complementary colors (opposite each other) create bold looks, while analogous colors (next to each other) feel harmonious. Neutrals like black, white, beige, and navy always work!";
    }

    if (messageLower.includes('blazer') || messageLower.includes('jacket')) {
      return "Blazers are incredibly versatile! Pair with jeans for smart-casual, over a dress for polish, or with matching pants for formal occasions. Roll the sleeves for a relaxed vibe!";
    }

    return "Great question! Focus on fit first - well-fitting clothes look better than expensive ill-fitting ones. Build a capsule wardrobe of quality basics, then add personality with accessories!";
  }

  /**
   * Handle color pairing queries with product search
   * e.g., "what goes with olive skirt", "what color top matches my navy pants"
   */
  private async handleColorPairingQuery(
    message: string,
    colorPairingIntent: { isPairingQuery: boolean; existingColor?: string; itemType?: string },
    context: ConversationContext,
    userContext: UserContext | undefined,
    observer: Subscriber<ChatChunk>,
  ): Promise<void> {
    const existingColor = colorPairingIntent.existingColor!;
    const itemType = colorPairingIntent.itemType || 'item';

    this.logger.log(`Handling color pairing query for ${existingColor} ${itemType}`);

    try {
      // Step 1: Get color pairing recommendations
      const colorPairings = this.colorPairingService.getColorPairings({
        existingColor,
        itemType,
      });

      this.logger.log(
        `Color pairing result for "${existingColor}": ` +
        `complementary=[${colorPairings.complementaryColors.join(', ')}], ` +
        `avoid=[${colorPairings.avoidColors.join(', ')}]`,
      );

      // Step 2: Determine what to search for (complementary item type)
      const searchItemType = this.getComplementaryItemType(itemType);

      // Step 3: Transform the search query
      const transformed = this.colorPairingService.transformSearchTermsForPairing(
        message,
        existingColor,
        itemType,
      );

      this.logger.log(
        `Transformed search: "${transformed.terms}" with colors [${transformed.colors.join(', ')}]`,
      );

      // Step 4: Send status update
      observer.next({
        type: 'status',
        status: 'searching',
        text: `Finding ${searchItemType}s that complement your ${existingColor} ${itemType}...`,
      });

      // Step 5: Execute product search with complementary colors
      const userId = userContext?.userId || context.userId || 'anonymous';
      const searchResult = await this.contextAwareSearchService.search({
        userId,
        query: `${searchItemType} ${transformed.colors.slice(0, 3).join(' OR ')}`,
        filters: {
          itemType: searchItemType,
          color: transformed.colors,
        },
        limit: 15,
        boostTrending: true,
        respectConstraints: true,
      });

      this.logger.log(
        `Color pairing search returned ${searchResult.products.length} products`,
      );

      // Step 6: Generate response text with fashion advice
      const responseText = this.generateColorPairingResponse(
        existingColor,
        itemType,
        colorPairings,
        searchResult.products.length,
      );

      observer.next({ type: 'text', text: responseText });

      // Step 7: Send product results
      observer.next({
        type: 'data',
        data: {
          products: searchResult.products,
          totalFound: searchResult.totalFound,
          colorPairing: {
            existingColor,
            itemType,
            complementaryColors: colorPairings.complementaryColors,
            neutralColors: colorPairings.neutralColors,
            avoidColors: colorPairings.avoidColors,
            stylingTips: colorPairings.stylingTips,
          },
          query: message,
          enhancedQuery: searchResult.context.enhancedQuery,
          sources: searchResult.sources,
          suggestedActions: [
            { label: 'Create an outfit', action: 'create_outfit' },
            { label: 'See more options', action: 'start_search' },
          ],
        },
        done: true,
      });

      observer.complete();
    } catch (error) {
      this.logger.error(`Color pairing search failed: ${(error as Error).message}`);

      // Fallback to fashion advice without products
      const colorPairings = this.colorPairingService.getColorPairings({
        existingColor,
        itemType,
      });

      const fallbackText = this.generateColorPairingResponse(
        existingColor,
        itemType,
        colorPairings,
        0,
      );

      observer.next({ type: 'text', text: fallbackText });
      observer.next({
        type: 'data',
        data: {
          colorPairing: {
            existingColor,
            itemType,
            complementaryColors: colorPairings.complementaryColors,
            neutralColors: colorPairings.neutralColors,
            avoidColors: colorPairings.avoidColors,
            stylingTips: colorPairings.stylingTips,
          },
        },
        done: true,
      });
      observer.complete();
    }
  }

  /**
   * Determine the complementary item type to search for
   * If user has a bottom (skirt/pants), search for tops
   * If user has a top (shirt/blouse), search for bottoms
   */
  private getComplementaryItemType(itemType: string): string {
    const lowerType = itemType.toLowerCase();

    // Bottoms -> search for tops
    const bottoms = ['skirt', 'pants', 'jeans', 'shorts', 'trousers', 'leggings'];
    if (bottoms.some(b => lowerType.includes(b))) {
      return 'top';
    }

    // Tops -> search for bottoms
    const tops = ['top', 'shirt', 'blouse', 'sweater', 'cardigan', 'jacket', 'blazer', 't-shirt', 'tee'];
    if (tops.some(t => lowerType.includes(t))) {
      return 'bottom';
    }

    // Dresses/one-pieces -> search for accessories/layers
    const dresses = ['dress', 'jumpsuit', 'romper'];
    if (dresses.some(d => lowerType.includes(d))) {
      return 'jacket OR cardigan OR accessories';
    }

    // Default: search for top
    return 'top';
  }

  /**
   * Generate a helpful response about color pairing
   */
  private generateColorPairingResponse(
    existingColor: string,
    itemType: string,
    colorPairings: ColorPairingResult,
    productCount: number,
  ): string {
    const complementaryList = colorPairings.complementaryColors.slice(0, 4).join(', ');
    const neutralList = colorPairings.neutralColors.slice(0, 3).join(', ');
    const avoidList = colorPairings.avoidColors.slice(0, 2).join(' or ');

    let response = `Great choice! Your ${existingColor} ${itemType} pairs beautifully with **${complementaryList}**. `;

    // Add neutral options
    if (colorPairings.neutralColors.length > 0) {
      response += `For a classic look, try **${neutralList}**. `;
    }

    // Add what to avoid
    if (colorPairings.avoidColors.length > 0) {
      response += `I'd suggest avoiding ${avoidList} to prevent clashing. `;
    }

    // Add product count info
    if (productCount > 0) {
      response += `\n\nI found ${productCount} items in these complementary colors for you:`;
    } else {
      // Add a styling tip when no products found
      if (colorPairings.stylingTips.length > 0) {
        response += `\n\n**Styling tip:** ${colorPairings.stylingTips[0]}`;
      }
    }

    return response;
  }
}
