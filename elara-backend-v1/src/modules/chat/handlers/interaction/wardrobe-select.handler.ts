import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subscriber } from 'rxjs';
import {
  IChatHandler,
  ChatChunk,
  ChatIntent,
  UserContext,
} from '../handler.interface';
import { ConversationContext } from '../../../pipeline/agents/dto/chat-message.dto';
import { SearchFilters, buildSearchQuery } from '../../../pipeline/search/dto/search-query.dto';
import { SearchOrchestratorService } from '../../../pipeline/search/search-orchestrator.service';
import { GeminiService } from '../../../pipeline/infrastructure/llm/gemini.service';

/**
 * Wardrobe Select Handler
 *
 * Handles requests related to the user's wardrobe:
 * - Finding items that match wardrobe pieces
 * - Creating outfits using wardrobe items
 * - Suggesting items to complement the wardrobe
 *
 * Examples:
 * - "What can I wear with my blue blazer?"
 * - "Create an outfit using items from my wardrobe"
 * - "Find shoes that match my dresses"
 */
@Injectable()
export class WardrobeSelectHandler implements IChatHandler {
  private readonly logger = new Logger(WardrobeSelectHandler.name);

  constructor(
    private searchOrchestrator: SearchOrchestratorService,
    private geminiService: GeminiService,
  ) {}

  canHandle(intent: ChatIntent): boolean {
    return intent === ChatIntent.WARDROBE_SELECT;
  }

  handle(
    message: string,
    context: ConversationContext,
    filters?: SearchFilters,
    userContext?: UserContext,
  ): Observable<ChatChunk> {
    return new Observable((observer) => {
      this.processWardrobeRequest(message, context, filters, userContext, observer);
    });
  }

  private async processWardrobeRequest(
    message: string,
    context: ConversationContext,
    filters: SearchFilters | undefined,
    userContext: UserContext | undefined,
    observer: Subscriber<ChatChunk>,
  ): Promise<void> {
    try {
      // Check if user has wardrobe items
      const wardrobeItems = userContext?.wardrobe || [];

      if (wardrobeItems.length === 0) {
        observer.next({
          type: 'text',
          text: "I don't see any items in your wardrobe yet. Would you like to add some items, or shall I search for new products instead?",
        });
        observer.next({
          type: 'data',
          data: {
            hasWardrobe: false,
            suggestedActions: [
              { label: 'Add wardrobe items', action: 'add_wardrobe' },
              { label: 'Search for products', action: 'start_search' },
            ],
          },
          done: true,
        });
        observer.complete();
        return;
      }

      // Parse what the user wants
      const request = this.parseWardrobeRequest(message);

      observer.next({
        type: 'status',
        status: 'analyzing',
        text: 'Analyzing your wardrobe...',
      });

      if (request.type === 'match_item' && request.itemDescription) {
        await this.findMatchingItems(
          request.itemDescription,
          wardrobeItems,
          filters,
          userContext,
          observer,
        );
      } else if (request.type === 'create_outfit') {
        await this.createWardrobeOutfit(
          message,
          wardrobeItems,
          filters,
          userContext,
          observer,
        );
      } else {
        await this.suggestComplement(
          wardrobeItems,
          filters,
          userContext,
          observer,
        );
      }
    } catch (error) {
      this.logger.error(`Wardrobe request failed: ${(error as Error).message}`);
      observer.next({
        type: 'text',
        text: "I'm having trouble with your wardrobe request. Would you like me to search for products instead?",
      });
      observer.error(error);
    }
  }

  private parseWardrobeRequest(message: string): {
    type: 'match_item' | 'create_outfit' | 'suggest_complement';
    itemDescription?: string;
  } {
    const messageLower = message.toLowerCase();

    // Check for matching specific item
    const matchPatterns = [
      /what (?:can i|should i|to) wear with (?:my )?(.+)/i,
      /match (?:with )?(?:my )?(.+)/i,
      /goes? well with (?:my )?(.+)/i,
      /pair (?:with )?(?:my )?(.+)/i,
    ];

    for (const pattern of matchPatterns) {
      const match = message.match(pattern);
      if (match) {
        return {
          type: 'match_item',
          itemDescription: match[1].trim(),
        };
      }
    }

    // Check for outfit creation
    if (
      messageLower.includes('create outfit') ||
      messageLower.includes('make outfit') ||
      messageLower.includes('using my wardrobe') ||
      messageLower.includes('from my wardrobe')
    ) {
      return { type: 'create_outfit' };
    }

    // Default: suggest complement
    return { type: 'suggest_complement' };
  }

  private async findMatchingItems(
    itemDescription: string,
    wardrobeItems: any[],
    filters: SearchFilters | undefined,
    userContext: UserContext | undefined,
    observer: Subscriber<ChatChunk>,
  ): Promise<void> {
    observer.next({
      type: 'status',
      status: 'searching',
      text: `Finding items to match your ${itemDescription}...`,
    });

    // Find the wardrobe item being referenced
    const referencedItem = this.findWardrobeItem(itemDescription, wardrobeItems);

    // Generate search based on the item
    const complementarySearch = this.generateComplementarySearch(
      referencedItem,
      itemDescription,
    );

    const searchQuery = buildSearchQuery(
      complementarySearch,
      filters || {},
      userContext,
    );
    searchQuery.limit = 15;

    const result = await this.searchOrchestrator.search(searchQuery, userContext);

    if (result.products.length === 0) {
      observer.next({
        type: 'text',
        text: `I couldn't find items to match your ${itemDescription}. Would you like to try a different search?`,
      });
      observer.next({ type: 'data', data: { products: [] }, done: true });
      observer.complete();
      return;
    }

    observer.next({
      type: 'text',
      text: `Here are ${result.products.length} items that would go great with your ${itemDescription}:`,
    });

    observer.next({
      type: 'data',
      data: {
        products: result.products,
        matchedWith: referencedItem || itemDescription,
      },
      done: true,
    });

    observer.complete();
  }

  private async createWardrobeOutfit(
    message: string,
    wardrobeItems: any[],
    filters: SearchFilters | undefined,
    userContext: UserContext | undefined,
    observer: Subscriber<ChatChunk>,
  ): Promise<void> {
    observer.next({
      type: 'status',
      status: 'creating',
      text: 'Creating outfits from your wardrobe...',
    });

    // Use Gemini to create outfit combinations from wardrobe
    const outfits = await this.generateWardrobeOutfits(
      wardrobeItems,
      filters,
      userContext,
    );

    if (outfits.length === 0) {
      observer.next({
        type: 'text',
        text: "I couldn't create complete outfits from your current wardrobe. Would you like me to suggest items to add?",
      });
      observer.next({
        type: 'data',
        data: {
          outfits: [],
          suggestedActions: [
            { label: 'Suggest items to add', action: 'suggest_complement' },
            { label: 'Search for products', action: 'start_search' },
          ],
        },
        done: true,
      });
      observer.complete();
      return;
    }

    observer.next({
      type: 'text',
      text: `I've created ${outfits.length} outfit${outfits.length > 1 ? 's' : ''} from your wardrobe!`,
    });

    observer.next({
      type: 'data',
      data: {
        outfits,
        fromWardrobe: true,
      },
      done: true,
    });

    observer.complete();
  }

  private async suggestComplement(
    wardrobeItems: any[],
    filters: SearchFilters | undefined,
    userContext: UserContext | undefined,
    observer: Subscriber<ChatChunk>,
  ): Promise<void> {
    observer.next({
      type: 'status',
      status: 'analyzing',
      text: 'Analyzing your wardrobe for gaps...',
    });

    // Analyze wardrobe for missing categories
    const gaps = this.analyzeWardrobeGaps(wardrobeItems);

    if (gaps.length === 0) {
      observer.next({
        type: 'text',
        text: 'Your wardrobe looks well-rounded! Would you like me to suggest some trendy additions or search for specific items?',
      });
      observer.next({
        type: 'data',
        data: { gaps: [], wardrobeComplete: true },
        done: true,
      });
      observer.complete();
      return;
    }

    // Search for items to fill gaps
    const suggestions: any[] = [];
    for (const gap of gaps.slice(0, 3)) {
      const searchQuery = buildSearchQuery(gap.search, filters || {}, userContext);
      searchQuery.limit = 5;

      const result = await this.searchOrchestrator.search(searchQuery, userContext);
      if (result.products.length > 0) {
        suggestions.push({
          category: gap.category,
          reason: gap.reason,
          products: result.products.slice(0, 3),
        });
      }
    }

    observer.next({
      type: 'text',
      text: `Based on your wardrobe, here are some items that would complete your collection:`,
    });

    observer.next({
      type: 'data',
      data: {
        suggestions,
        gaps: gaps.map((g) => g.category),
      },
      done: true,
    });

    observer.complete();
  }

  private findWardrobeItem(description: string, items: any[]): any | null {
    const descLower = description.toLowerCase();

    for (const item of items) {
      const itemName = (item.name || item.title || '').toLowerCase();
      const itemCategory = (item.category || '').toLowerCase();
      const itemColor = (item.color || '').toLowerCase();

      if (
        itemName.includes(descLower) ||
        descLower.includes(itemCategory) ||
        descLower.includes(itemColor)
      ) {
        return item;
      }
    }

    return null;
  }

  private generateComplementarySearch(item: any | null, description: string): string {
    if (!item) {
      return `items to match ${description}`;
    }

    const category = item.category || '';
    const color = item.color || '';

    // Generate complementary search based on item type
    const complementMap: Record<string, string> = {
      top: 'bottoms pants jeans skirts',
      bottom: 'tops shirts blouses',
      dress: 'shoes accessories jewelry cardigan',
      shoes: 'matching outfit accessories',
      outerwear: 'tops bottoms',
    };

    const complement = complementMap[category.toLowerCase()] || 'matching items';
    return `${complement} ${color ? `to match ${color}` : ''}`;
  }

  private async generateWardrobeOutfits(
    items: any[],
    filters: SearchFilters | undefined,
    userContext: UserContext | undefined,
  ): Promise<any[]> {
    // Group items by category
    const byCategory: Record<string, any[]> = {};
    for (const item of items) {
      const cat = item.category || 'other';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(item);
    }

    // Create simple outfit combinations
    const outfits: any[] = [];
    const tops = byCategory['top'] || [];
    const bottoms = byCategory['bottom'] || [];
    const dresses = byCategory['dress'] || [];
    const shoes = byCategory['shoes'] || [];

    // Create outfits from tops + bottoms
    for (let i = 0; i < Math.min(tops.length, 2); i++) {
      for (let j = 0; j < Math.min(bottoms.length, 2); j++) {
        if (outfits.length >= 3) break;

        const outfitItems = [
          { ...tops[i], category: 'top' },
          { ...bottoms[j], category: 'bottom' },
        ];

        if (shoes[0]) {
          outfitItems.push({ ...shoes[0], category: 'shoes' });
        }

        outfits.push({
          outfit_id: outfits.length + 1,
          name: `Wardrobe Outfit ${outfits.length + 1}`,
          items: outfitItems,
          fromWardrobe: true,
          reasoning: 'Created from your existing wardrobe pieces.',
        });
      }
    }

    // Add dress outfits
    for (const dress of dresses.slice(0, 2)) {
      if (outfits.length >= 3) break;

      const outfitItems = [{ ...dress, category: 'dress' }];
      if (shoes[0]) {
        outfitItems.push({ ...shoes[0], category: 'shoes' });
      }

      outfits.push({
        outfit_id: outfits.length + 1,
        name: `Dress Outfit ${outfits.length + 1}`,
        items: outfitItems,
        fromWardrobe: true,
        reasoning: 'A complete dress look from your wardrobe.',
      });
    }

    return outfits;
  }

  private analyzeWardrobeGaps(items: any[]): Array<{
    category: string;
    reason: string;
    search: string;
  }> {
    const categories = items.map((i) => (i.category || '').toLowerCase());
    const gaps: Array<{ category: string; reason: string; search: string }> = [];

    // Essential categories
    const essentials = [
      { cat: 'top', search: 'versatile tops shirts', reason: 'Every wardrobe needs versatile tops' },
      { cat: 'bottom', search: 'classic pants jeans', reason: 'A good pair of bottoms is essential' },
      { cat: 'shoes', search: 'comfortable stylish shoes', reason: 'Quality footwear completes any look' },
      { cat: 'outerwear', search: 'jacket blazer cardigan', reason: 'Layering pieces add versatility' },
    ];

    for (const essential of essentials) {
      if (!categories.some((c) => c.includes(essential.cat))) {
        gaps.push({
          category: essential.cat,
          reason: essential.reason,
          search: essential.search,
        });
      }
    }

    return gaps;
  }
}
