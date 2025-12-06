import { Injectable, Logger } from '@nestjs/common';
import { IChatHandler } from './handler.interface';
import { SingleItemHandler } from './search/single-item.handler';
import { CompleteOutfitHandler } from './search/complete-outfit.handler';
import { ItemReplacementHandler } from './interaction/item-replacement.handler';
import { ClarificationHandler } from './interaction/clarification.handler';
import { FeedbackHandler } from './interaction/feedback.handler';
import { GeneralChatHandler } from './chat/general-chat.handler';
import { WardrobeSelectHandler } from './interaction/wardrobe-select.handler';

/**
 * Handler Registry Service
 *
 * Manages the ordering and instantiation of chat handlers.
 * Avoids circular dependency issues by not using factory providers.
 */
@Injectable()
export class ChatHandlerRegistry {
  private readonly logger = new Logger(ChatHandlerRegistry.name);
  private handlers: IChatHandler[];

  constructor(
    private readonly singleItemHandler: SingleItemHandler,
    private readonly completeOutfitHandler: CompleteOutfitHandler,
    private readonly itemReplacementHandler: ItemReplacementHandler,
    private readonly clarificationHandler: ClarificationHandler,
    private readonly feedbackHandler: FeedbackHandler,
    private readonly generalChatHandler: GeneralChatHandler,
    private readonly wardrobeSelectHandler: WardrobeSelectHandler,
  ) {
    // Initialize handlers in order - more specific handlers first
    this.handlers = [
      this.singleItemHandler,
      this.completeOutfitHandler,
      this.itemReplacementHandler,
      this.wardrobeSelectHandler,
      this.feedbackHandler,
      this.clarificationHandler,
      this.generalChatHandler, // General chat is the fallback
    ];

    this.logger.log(`Initialized handler registry with ${this.handlers.length} handlers`);
  }

  /**
   * Get the ordered list of chat handlers
   */
  getHandlers(): IChatHandler[] {
    return this.handlers;
  }
}
