import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { ConversationService } from './services/conversation.service';
import {
  Conversation,
  ConversationSchema,
} from './domain/schemas/conversation.schema';
import { Message, MessageSchema } from './domain/schemas/message.schema';
import {
  ProductFeedback,
  ProductFeedbackSchema,
} from './domain/schemas/feedback.schema';

// Import the full pipeline agents module
import { AgentsModule } from '../pipeline/agents/agents.module';
import { OnboardingModule } from '../onboarding/onboarding.module';

// Import handlers module for intent-based routing
import { HandlersModule } from './handlers/handlers.module';

/**
 * Chat Module
 *
 * WebSocket gateway for real-time chat interactions.
 * Uses a Handler Pattern for intent-based routing with RxJS Observable streaming:
 * - HandlerDispatcherService routes to appropriate handler
 * - Each handler returns Observable<ChatChunk> for streaming
 * - Supports: search, outfits, replacement, feedback, wardrobe, general chat
 */
@Module({
  imports: [
    ConfigModule,
    AgentsModule, // Full AI pipeline orchestration
    OnboardingModule, // User profile access
    HandlersModule, // Handler pattern for intent routing
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
      { name: ProductFeedback.name, schema: ProductFeedbackSchema },
    ]),
  ],
  providers: [ChatGateway, ConversationService],
  exports: [ConversationService],
})
export class ChatModule {}
