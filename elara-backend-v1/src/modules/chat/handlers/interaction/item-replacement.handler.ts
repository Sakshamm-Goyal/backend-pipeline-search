import { Injectable, Logger, Optional } from '@nestjs/common';
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
import { ClaudeService } from '../../../pipeline/infrastructure/llm/claude.service';
import { OutfitGeneratorAgentService } from '../../../pipeline/agents/services/outfit-generator-agent.service';
import {
  ConstraintStoreService,
  ConstraintType,
} from '../../../pipeline/context/services/constraint-store.service';

/**
 * Slot replacement constraints extracted from user message
 */
interface SlotReplacementConstraints {
  avoidColors?: string[];
  preferColors?: string[];
  avoidStyles?: string[];
  preferStyles?: string[];
  requirement?: string;
}

/**
 * Item Replacement Handler
 *
 * ENHANCED: Handles requests to replace items in previously shown outfits.
 * Now uses OutfitGeneratorAgentService for context-aware replacement
 * and ConstraintStoreService to extract color/style preferences.
 *
 * Examples:
 * - "Replace the shoes in outfit 2"
 * - "Show me a different top"
 * - "I don't like the pants, find something else"
 * - "Change the shoes to a different color" (extracts color constraint)
 * - "Replace with something less formal" (extracts style constraint)
 */
@Injectable()
export class ItemReplacementHandler implements IChatHandler {
  private readonly logger = new Logger(ItemReplacementHandler.name);

  constructor(
    private searchOrchestrator: SearchOrchestratorService,
    private claudeService: ClaudeService,
    @Optional() private outfitGenerator?: OutfitGeneratorAgentService,
    @Optional() private constraintStore?: ConstraintStoreService,
  ) {}

  canHandle(intent: ChatIntent): boolean {
    return intent === ChatIntent.ITEM_REPLACEMENT;
  }

  handle(
    message: string,
    context: ConversationContext,
    filters?: SearchFilters,
    userContext?: UserContext,
  ): Observable<ChatChunk> {
    return new Observable((observer) => {
      this.executeReplacement(message, context, filters, userContext, observer);
    });
  }

  private async executeReplacement(
    message: string,
    context: ConversationContext,
    filters: SearchFilters | undefined,
    userContext: UserContext | undefined,
    observer: Subscriber<ChatChunk>,
  ): Promise<void> {
    try {
      // Step 1: Parse what to replace and extract constraints
      observer.next({
        type: 'status',
        status: 'parsing',
        text: 'Understanding what to replace...',
      });

      const replacement = await this.parseReplacementRequest(message, context);

      if (!replacement) {
        observer.next({
          type: 'text',
          text: "I couldn't understand which item you'd like to replace. Could you specify the item (shoes, top, bottom, etc.) and which outfit?",
        });
        observer.next({ type: 'data', data: {}, done: true });
        observer.complete();
        return;
      }

      const { outfitIndex, itemSlot, excludeUrls, constraints } = replacement;

      // Step 2: Check if we have the previous outfit
      const previousOutfits = context.metadata?.lastOutfits || [];

      // ENHANCEMENT: If no outfit context exists, fall back to product search
      if (previousOutfits.length === 0 || outfitIndex >= previousOutfits.length) {
        this.logger.log(`No outfit context, falling back to product search for "${itemSlot}"`);
        await this.fallbackToProductSearch(itemSlot, filters, userContext, constraints, observer);
        return;
      }

      const previousOutfit = previousOutfits[outfitIndex];
      const outfitId = previousOutfit.id || `outfit_${outfitIndex + 1}`;

      // Step 3: Use OutfitGeneratorAgent for context-aware replacement (if available)
      if (this.outfitGenerator) {
        observer.next({
          type: 'status',
          status: 'searching',
          text: `Finding the perfect ${itemSlot} replacement...`,
        });

        try {
          const replacementResult = await this.outfitGenerator.replaceOutfitItem(
            outfitId,
            itemSlot,
            userContext,
            constraints,
          );

          if (replacementResult.bestReplacement) {
            // Create updated outfit with best replacement
            const newItem = replacementResult.bestReplacement;
            const updatedOutfit = this.createUpdatedOutfit(
              previousOutfit,
              itemSlot,
              newItem,
            );

            // Format alternatives for display
            const formattedAlternatives = replacementResult.alternatives.map((p) => ({
              product_id: p.id,
              name: p.title,
              price: p.price ? `$${p.price.toFixed(2)}` : 'Price unavailable',
              url: p.productUrl,
              image_url: p.imageUrl,
              retailer: p.retailer,
              brand: p.brand,
            }));

            // Generate response message based on constraints
            let responseMessage = `Here's your outfit with a new ${itemSlot}:`;
            if (constraints?.preferColors?.length) {
              responseMessage = `Here's your outfit with a ${constraints.preferColors[0]} ${itemSlot}:`;
            } else if (constraints?.avoidColors?.length) {
              responseMessage = `Here's your outfit with a different ${itemSlot} (avoiding ${constraints.avoidColors.join(', ')}):`;
            }

            observer.next({
              type: 'text',
              text: responseMessage,
            });

            observer.next({
              type: 'data',
              data: {
                type: 'slot_replacement',
                outfit: updatedOutfit,
                bestReplacement: {
                  product_id: newItem.id,
                  name: newItem.title,
                  price: newItem.price ? `$${newItem.price.toFixed(2)}` : 'Price unavailable',
                  url: newItem.productUrl,
                  image_url: newItem.imageUrl,
                  retailer: newItem.retailer,
                  brand: newItem.brand,
                },
                alternatives: formattedAlternatives,
                replacedSlot: itemSlot,
                constraintsApplied: constraints,
              },
              done: true,
            });

            this.logger.log(
              `Replaced ${itemSlot} in outfit ${outfitIndex + 1} with ${formattedAlternatives.length} alternatives`,
            );

            observer.complete();
            return;
          }
        } catch (error) {
          this.logger.warn(
            `OutfitGenerator replacement failed: ${(error as Error).message}, falling back to search`,
          );
        }
      }

      // Fallback: Use direct search
      observer.next({
        type: 'status',
        status: 'searching',
        text: `Finding alternative ${itemSlot}...`,
      });

      const searchQuery = buildSearchQuery(
        `${itemSlot} ${previousOutfit.style || ''}`,
        {
          ...filters,
          itemType: itemSlot,
          color: constraints?.preferColors,
        },
        userContext,
      );
      searchQuery.limit = 10;

      const result = await this.searchOrchestrator.search(searchQuery, userContext);

      // Filter out the original item and apply constraints
      let alternatives = result.products.filter(
        (p) => !excludeUrls.includes(p.productUrl),
      );

      // Apply constraint filtering
      if (constraints?.avoidColors?.length && this.constraintStore) {
        const preferences = {
          avoidColors: constraints.avoidColors,
          preferColors: constraints.preferColors || [],
          avoidBrands: [],
          preferBrands: [],
          avoidStyles: constraints.avoidStyles || [],
          preferStyles: constraints.preferStyles || [],
        };
        alternatives = this.constraintStore.applyConstraintsToProducts(alternatives, preferences);
      }

      if (alternatives.length === 0) {
        observer.next({
          type: 'text',
          text: `I couldn't find alternative ${itemSlot}${constraints?.avoidColors?.length ? ` avoiding ${constraints.avoidColors.join(', ')}` : ''}. Would you like to search with different criteria?`,
        });
        observer.next({ type: 'data', data: {}, done: true });
        observer.complete();
        return;
      }

      // Create updated outfit with replacement
      const newItem = alternatives[0];
      const updatedOutfit = this.createUpdatedOutfit(
        previousOutfit,
        itemSlot,
        newItem,
      );

      observer.next({
        type: 'text',
        text: `Here's your outfit with a new ${itemSlot}:`,
      });

      observer.next({
        type: 'data',
        data: {
          type: 'slot_replacement',
          outfit: updatedOutfit,
          bestReplacement: {
            product_id: newItem.id,
            name: newItem.title,
            price: newItem.price ? `$${newItem.price.toFixed(2)}` : 'Price unavailable',
            url: newItem.productUrl,
            image_url: newItem.imageUrl,
            retailer: newItem.retailer,
            brand: newItem.brand,
          },
          alternatives: alternatives.slice(1, 4).map((p) => ({
            product_id: p.id,
            name: p.title,
            price: p.price ? `$${p.price.toFixed(2)}` : 'Price unavailable',
            url: p.productUrl,
            image_url: p.imageUrl,
            retailer: p.retailer,
            brand: p.brand,
          })),
          replacedSlot: itemSlot,
        },
        done: true,
      });

      this.logger.log(`Replaced ${itemSlot} in outfit ${outfitIndex + 1}`);

      observer.complete();
    } catch (error) {
      this.logger.error(`Replacement failed: ${(error as Error).message}`);
      observer.next({
        type: 'text',
        text: "I'm having trouble finding replacements. Please try again.",
      });
      observer.error(error);
    }
  }

  /**
   * Fallback product search when no outfit context exists
   */
  private async fallbackToProductSearch(
    itemSlot: string,
    filters: SearchFilters | undefined,
    userContext: UserContext | undefined,
    constraints: SlotReplacementConstraints | undefined,
    observer: Subscriber<ChatChunk>,
  ): Promise<void> {
    observer.next({
      type: 'status',
      status: 'searching',
      text: `Searching for ${itemSlot}...`,
    });

    const searchQuery = buildSearchQuery(
      itemSlot,
      {
        ...filters,
        itemType: itemSlot,
        color: constraints?.preferColors,
      },
      userContext,
    );
    searchQuery.limit = 10;

    const result = await this.searchOrchestrator.search(searchQuery, userContext);

    // Apply constraint filtering
    let products = result.products;
    if (constraints?.avoidColors?.length && this.constraintStore) {
      const preferences = {
        avoidColors: constraints.avoidColors,
        preferColors: constraints.preferColors || [],
        avoidBrands: [],
        preferBrands: [],
        avoidStyles: constraints.avoidStyles || [],
        preferStyles: constraints.preferStyles || [],
      };
      products = this.constraintStore.applyConstraintsToProducts(products, preferences);
    }

    if (products.length === 0) {
      observer.next({
        type: 'text',
        text: `I couldn't find any ${itemSlot}. Would you like to try a different search?`,
      });
      observer.next({ type: 'data', data: {}, done: true });
      observer.complete();
      return;
    }

    // Return products with best pick + alternatives format
    const bestPick = products[0];
    const alternatives = products.slice(1, 4);

    observer.next({
      type: 'text',
      text: `Here are some ${itemSlot} options I found for you:`,
    });

    observer.next({
      type: 'data',
      data: {
        type: 'product_list',
        bestPick: {
          product_id: bestPick.id,
          name: bestPick.title,
          price: bestPick.price ? `$${bestPick.price.toFixed(2)}` : 'Price unavailable',
          url: bestPick.productUrl,
          image_url: bestPick.imageUrl,
          retailer: bestPick.retailer,
          brand: bestPick.brand,
        },
        alternatives: alternatives.map((p) => ({
          product_id: p.id,
          name: p.title,
          price: p.price ? `$${p.price.toFixed(2)}` : 'Price unavailable',
          url: p.productUrl,
          image_url: p.imageUrl,
          retailer: p.retailer,
          brand: p.brand,
        })),
        totalFound: products.length,
      },
      done: true,
    });

    observer.complete();
  }

  private async parseReplacementRequest(
    message: string,
    context: ConversationContext,
  ): Promise<{
    outfitIndex: number;
    itemSlot: string;
    excludeUrls: string[];
    constraints: SlotReplacementConstraints;
  } | null> {
    const messageLower = message.toLowerCase();

    // Extract outfit number (default to 0 if not specified)
    let outfitIndex = 0;
    const outfitMatch = messageLower.match(/outfit\s*(\d+)/);
    if (outfitMatch) {
      outfitIndex = parseInt(outfitMatch[1], 10) - 1; // Convert to 0-indexed
    }

    // Extract item slot
    const slotKeywords: Record<string, string[]> = {
      top: ['top', 'shirt', 'blouse', 'tee', 't-shirt', 'sweater'],
      bottom: ['bottom', 'pants', 'jeans', 'skirt', 'shorts', 'trousers'],
      shoes: ['shoes', 'footwear', 'sneakers', 'boots', 'heels', 'sandals'],
      dress: ['dress', 'gown'],
      outerwear: ['jacket', 'coat', 'blazer', 'cardigan', 'outerwear'],
      accessories: ['accessories', 'bag', 'belt', 'jewelry', 'watch'],
    };

    let itemSlot: string | null = null;
    for (const [slot, keywords] of Object.entries(slotKeywords)) {
      if (keywords.some((kw) => messageLower.includes(kw))) {
        itemSlot = slot;
        break;
      }
    }

    if (!itemSlot) {
      // If no specific slot mentioned, check if we can infer from context
      // or return null to ask for clarification
      return null;
    }

    // Get URLs to exclude from previous outfit
    const previousOutfits = context.metadata?.lastOutfits || [];
    const excludeUrls: string[] = [];

    if (previousOutfits[outfitIndex]) {
      const items = previousOutfits[outfitIndex].items || [];
      const currentItem = items.find(
        (item: any) => item.category === itemSlot,
      );
      if (currentItem?.url) {
        excludeUrls.push(currentItem.url);
      }
    }

    // ENHANCED: Extract constraints from user message
    const constraints = this.extractConstraintsFromMessage(messageLower);

    return { outfitIndex, itemSlot, excludeUrls, constraints };
  }

  /**
   * Extract color, style, and other constraints from user message
   * Examples:
   * - "replace shoes with black ones" -> preferColors: ['black']
   * - "different color shoes, not black" -> avoidColors: ['black']
   * - "something more casual" -> preferStyles: ['casual']
   */
  private extractConstraintsFromMessage(message: string): SlotReplacementConstraints {
    const constraints: SlotReplacementConstraints = {};

    // Color words for extraction
    const colorWords = new Set([
      'black', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'purple',
      'pink', 'brown', 'gray', 'grey', 'navy', 'beige', 'cream', 'burgundy',
      'maroon', 'olive', 'teal', 'coral', 'gold', 'silver', 'tan', 'khaki',
      'nude', 'blush', 'rose', 'mint', 'lavender', 'charcoal',
    ]);

    // Pattern: "with [color]" or "[color] ones" or "in [color]"
    const preferColorPatterns = [
      /(?:with|in|want|prefer)\s+(?:a\s+)?(\w+)(?:\s+one)?/i,
      /(\w+)\s+(?:one|version|option)/i,
      /something\s+(\w+)/i,
    ];

    for (const pattern of preferColorPatterns) {
      const match = message.match(pattern);
      if (match && match[1] && colorWords.has(match[1].toLowerCase())) {
        constraints.preferColors = constraints.preferColors || [];
        constraints.preferColors.push(match[1].toLowerCase());
      }
    }

    // Pattern: "not [color]" or "avoid [color]" or "no [color]"
    const avoidColorPatterns = [
      /(?:not|avoid|no|without|except)\s+(?:the\s+)?(\w+)/i,
      /don't\s+(?:want|like)\s+(\w+)/i,
      /anything\s+but\s+(\w+)/i,
    ];

    for (const pattern of avoidColorPatterns) {
      const match = message.match(pattern);
      if (match && match[1] && colorWords.has(match[1].toLowerCase())) {
        constraints.avoidColors = constraints.avoidColors || [];
        constraints.avoidColors.push(match[1].toLowerCase());
      }
    }

    // Pattern: "different color" without specifying which -> request for color variety
    if (message.includes('different color') || message.includes('another color')) {
      // Get the current item's color from context if available
      constraints.requirement = 'different_color';
    }

    // Style preferences
    const styleKeywords: Record<string, string[]> = {
      casual: ['casual', 'relaxed', 'everyday', 'comfortable'],
      formal: ['formal', 'dressy', 'elegant', 'sophisticated'],
      sporty: ['sporty', 'athletic', 'active'],
      minimalist: ['minimal', 'minimalist', 'simple', 'clean'],
      trendy: ['trendy', 'stylish', 'modern', 'fashionable'],
      classic: ['classic', 'timeless', 'traditional'],
    };

    // Extract style preferences
    for (const [style, keywords] of Object.entries(styleKeywords)) {
      if (keywords.some((kw) => message.includes(kw))) {
        // Check if it's a preference or avoidance
        if (message.includes(`more ${style}`) || message.includes(`something ${style}`) || message.includes(`want ${style}`)) {
          constraints.preferStyles = constraints.preferStyles || [];
          constraints.preferStyles.push(style);
        } else if (message.includes(`less ${style}`) || message.includes(`not ${style}`) || message.includes(`avoid ${style}`)) {
          constraints.avoidStyles = constraints.avoidStyles || [];
          constraints.avoidStyles.push(style);
        }
      }
    }

    return constraints;
  }

  private createUpdatedOutfit(
    previousOutfit: any,
    slotToReplace: string,
    newItem: any,
  ): any {
    const updatedItems = (previousOutfit.items || []).map((item: any) => {
      if (item.category === slotToReplace) {
        return {
          category: slotToReplace,
          name: newItem.title,
          price: `$${newItem.price?.toFixed(2) || '0.00'}`,
          url: newItem.productUrl,
          image_url: newItem.imageUrl,
          retailer: newItem.retailer,
          product_id: newItem.id,
          brand: newItem.brand,
          isReplacement: true,
        };
      }
      return item;
    });

    // Recalculate total price
    const totalPrice = updatedItems.reduce((sum: number, item: any) => {
      const price = parseFloat(item.price?.replace('$', '') || '0');
      return sum + price;
    }, 0);

    return {
      ...previousOutfit,
      items: updatedItems,
      total_price: `$${totalPrice.toFixed(2)}`,
      reasoning: `Updated outfit with new ${slotToReplace}.`,
    };
  }
}
