import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

// Handlers
import { SingleItemHandler } from './search/single-item.handler';
import { CompleteOutfitHandler } from './search/complete-outfit.handler';
import { ItemReplacementHandler } from './interaction/item-replacement.handler';
import { ClarificationHandler } from './interaction/clarification.handler';
import { FeedbackHandler } from './interaction/feedback.handler';
import { GeneralChatHandler } from './chat/general-chat.handler';
import { WardrobeSelectHandler } from './interaction/wardrobe-select.handler';

// Dispatcher
import { HandlerDispatcherService } from './handler-dispatcher.service';
import { ChatHandlerRegistry } from './handler-registry.service';

// Services from pipeline
import { SearchModule } from '../../pipeline/search/search.module';
import { LLMModule } from '../../pipeline/infrastructure/llm/llm.module';
import { OutfitScoringModule } from '../../pipeline/outfit-scoring/outfit-scoring.module';
import { ContextModule } from '../../pipeline/context/context.module';
import { AgentsModule } from '../../pipeline/agents/agents.module';

// Schemas
import { ProductFeedback, ProductFeedbackSchema } from '../domain/schemas/feedback.schema';

@Module({
  imports: [
    forwardRef(() => SearchModule),
    forwardRef(() => LLMModule),
    forwardRef(() => OutfitScoringModule),
    forwardRef(() => ContextModule),
    forwardRef(() => AgentsModule), // For OutfitGeneratorAgentService in ItemReplacementHandler
    MongooseModule.forFeature([
      { name: ProductFeedback.name, schema: ProductFeedbackSchema },
    ]),
  ],
  providers: [
    // Individual handlers
    SingleItemHandler,
    CompleteOutfitHandler,
    ItemReplacementHandler,
    ClarificationHandler,
    FeedbackHandler,
    GeneralChatHandler,
    WardrobeSelectHandler,

    // Handler registry
    ChatHandlerRegistry,

    // Handler dispatcher
    HandlerDispatcherService,
  ],
  exports: [
    ChatHandlerRegistry,
    HandlerDispatcherService,
    SingleItemHandler,
    CompleteOutfitHandler,
    ItemReplacementHandler,
    ClarificationHandler,
    FeedbackHandler,
    GeneralChatHandler,
    WardrobeSelectHandler,
  ],
})
export class HandlersModule {}
