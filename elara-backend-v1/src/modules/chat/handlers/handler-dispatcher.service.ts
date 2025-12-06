import { Injectable, Logger } from '@nestjs/common';
import { Observable, of, Subject } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';

import { ChatHandlerRegistry } from './handler-registry.service';
import { IChatHandler, ChatChunk, ChatIntent, UserContext } from './handler.interface';
import { ConversationContext } from '../../pipeline/agents/dto/chat-message.dto';
import { SearchFilters } from '../../pipeline/search/dto/search-query.dto';
import { ClaudeService } from '../../pipeline/infrastructure/llm/claude.service';

/**
 * Handler Dispatcher Service
 *
 * Routes incoming chat messages to the appropriate handler based on intent classification.
 * Uses Claude for intent detection and manages the handler chain.
 */
@Injectable()
export class HandlerDispatcherService {
  private readonly logger = new Logger(HandlerDispatcherService.name);
  private readonly handlers: IChatHandler[];

  constructor(
    private readonly handlerRegistry: ChatHandlerRegistry,
    private readonly claudeService: ClaudeService,
  ) {
    this.handlers = this.handlerRegistry.getHandlers();
    this.logger.log(`Initialized with ${this.handlers.length} handlers`);
  }

  /**
   * Process a message and return a stream of chat chunks
   */
  processMessage(
    message: string,
    context: ConversationContext,
    filters?: SearchFilters,
    userContext?: UserContext,
  ): Observable<ChatChunk> {
    const subject = new Subject<ChatChunk>();

    this.dispatchMessage(message, context, filters, userContext, subject);

    return subject.asObservable();
  }

  private async dispatchMessage(
    message: string,
    context: ConversationContext,
    filters: SearchFilters | undefined,
    userContext: UserContext | undefined,
    subject: Subject<ChatChunk>,
  ): Promise<void> {
    try {
      // Step 1: Classify intent
      const intent = await this.classifyIntent(message, context);
      this.logger.log(`Classified intent: ${intent} for message: "${message.substring(0, 50)}..."`);

      // Step 2: Find handler
      const handler = this.findHandler(intent);

      if (!handler) {
        this.logger.warn(`No handler found for intent: ${intent}`);
        subject.next({
          type: 'text',
          text: "I'm not sure how to help with that. Could you try asking in a different way?",
        });
        subject.next({ type: 'data', data: { intent }, done: true });
        subject.complete();
        return;
      }

      // Step 3: Execute handler and pipe results
      handler
        .handle(message, context, filters, userContext)
        .pipe(
          catchError((error) => {
            this.logger.error(`Handler error: ${error.message}`);
            return of({
              type: 'text' as const,
              text: "I encountered an issue processing your request. Let me try again.",
            });
          }),
          finalize(() => {
            subject.complete();
          }),
        )
        .subscribe({
          next: (chunk) => subject.next(chunk),
          error: (error) => {
            this.logger.error(`Stream error: ${error.message}`);
            subject.error(error);
          },
        });
    } catch (error) {
      this.logger.error(`Dispatch error: ${(error as Error).message}`);
      subject.next({
        type: 'text',
        text: "Something went wrong. Please try again.",
      });
      subject.next({ type: 'data', data: {}, done: true });
      subject.complete();
    }
  }

  /**
   * Classify the intent of a message using Claude
   */
  private async classifyIntent(
    message: string,
    context: ConversationContext,
  ): Promise<ChatIntent> {
    const messageLower = message.toLowerCase();

    // Quick pattern matching for obvious intents
    const quickIntent = this.quickClassify(messageLower, context);
    if (quickIntent) {
      return quickIntent;
    }

    // Use Claude's intent classification service
    try {
      const conversationHistory = context.history.slice(-5).map(h => ({
        role: h.role as 'user' | 'assistant' | 'system',
        content: h.content,
      }));

      const classification = await this.claudeService.classifyIntent(
        message,
        conversationHistory,
        context.userContext || {},
      );

      // Map Claude's intent to ChatIntent enum
      const intentMap: Record<string, ChatIntent> = {
        'product_search': ChatIntent.SINGLE_ITEM_SEARCH,
        'single_item_search': ChatIntent.SINGLE_ITEM_SEARCH,
        'outfit_request': ChatIntent.COMPLETE_OUTFIT_SEARCH,
        'complete_outfit_search': ChatIntent.COMPLETE_OUTFIT_SEARCH,
        'item_replacement': ChatIntent.ITEM_REPLACEMENT,
        'wardrobe_select': ChatIntent.WARDROBE_SELECT,
        'feedback': ChatIntent.FEEDBACK,
        'clarification_needed': ChatIntent.CLARIFY,
        'clarify': ChatIntent.CLARIFY,
        'fashion_advice': ChatIntent.FASHION_ADVICE,
        'general_chat': ChatIntent.GENERAL_CHAT,
        'off_topic': ChatIntent.OFF_TOPIC,
      };

      const mappedIntent = intentMap[classification.intent.toLowerCase()];

      if (mappedIntent) {
        return mappedIntent;
      }

      // If confidence is low, use clarification
      if (classification.confidence < 0.7) {
        return ChatIntent.CLARIFY;
      }

      return ChatIntent.GENERAL_CHAT;
    } catch (error) {
      this.logger.error(`Intent classification failed: ${(error as Error).message}`);
      return ChatIntent.GENERAL_CHAT;
    }
  }

  /**
   * Quick pattern-based classification for obvious intents
   */
  private quickClassify(message: string, context: ConversationContext): ChatIntent | null {
    // Greetings
    const greetings = ['hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening'];
    if (greetings.some(g => message === g || message.startsWith(g + ' ') || message.startsWith(g + '!'))) {
      return ChatIntent.GENERAL_CHAT;
    }

    // Thanks
    if (message.includes('thank') || message === 'thanks' || message === 'ty') {
      return ChatIntent.GENERAL_CHAT;
    }

    // Feedback patterns
    const feedbackPatterns = ['i love', 'i like', 'i hate', "i don't like", 'too expensive', 'perfect', 'not my style'];
    if (feedbackPatterns.some(p => message.includes(p))) {
      return ChatIntent.FEEDBACK;
    }

    // Replacement patterns
    const replacementPatterns = ['replace', 'different', 'another', 'swap', 'change the'];
    const hasLastOutfits = context.metadata?.lastOutfits && context.metadata.lastOutfits.length > 0;
    if (replacementPatterns.some(p => message.includes(p)) && hasLastOutfits) {
      return ChatIntent.ITEM_REPLACEMENT;
    }

    // Wardrobe patterns
    if (message.includes('my wardrobe') || message.includes('with my ') || message.includes('using my')) {
      return ChatIntent.WARDROBE_SELECT;
    }

    // Outfit patterns
    const outfitPatterns = ['outfit', 'look for', 'complete look', 'what to wear', 'dress for', 'going to'];
    if (outfitPatterns.some(p => message.includes(p))) {
      return ChatIntent.COMPLETE_OUTFIT_SEARCH;
    }

    // Single item patterns
    const itemKeywords = ['find', 'show me', 'looking for', 'search', 'need a', 'want a', 'buy'];
    const itemTypes = ['dress', 'shirt', 'pants', 'shoes', 'jacket', 'top', 'bottom', 'skirt', 'jeans', 'sneakers'];
    if (itemKeywords.some(k => message.includes(k)) && itemTypes.some(t => message.includes(t))) {
      return ChatIntent.SINGLE_ITEM_SEARCH;
    }

    // Very vague
    if (message.length < 15 && !message.includes(' ')) {
      return ChatIntent.CLARIFY;
    }

    return null;
  }

  /**
   * Find the appropriate handler for an intent
   */
  private findHandler(intent: ChatIntent): IChatHandler | undefined {
    return this.handlers.find((handler) => handler.canHandle(intent));
  }

  /**
   * Get available intents for debugging
   */
  getAvailableIntents(): ChatIntent[] {
    return Object.values(ChatIntent);
  }
}
