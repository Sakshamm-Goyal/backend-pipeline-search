import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

// LLM Services
import { LLMModule } from '../infrastructure/llm/llm.module';

// Search Services
import { SearchModule } from '../search/search.module';

// Product persistence (for SearchAgentService)
import { ProductsModule } from '../products/products.module';

// Outfit Scoring (for OutfitGeneratorAgentService)
import { OutfitScoringModule } from '../outfit-scoring/outfit-scoring.module';

// Analytics & Search History
import { AnalyticsModule } from '../analytics/analytics.module';
import { SearchHistoryModule } from '../search-history/search-history.module';

// Onboarding (for user profile in chat)
import { OnboardingModule } from '../../onboarding/onboarding.module';

// Wardrobe (for outfit generation with user's existing items)
import { WardrobeModule } from '../../wardrobe/wardrobe.module';

// Context (for constraint store)
import { ContextModule } from '../context/context.module';

// Reasoning (for safety validation and fashion reasoning)
import { ReasoningModule } from '../reasoning/reasoning.module';

// Agent Services
import { IntentRouterService } from './services/intent-router.service';
import { SearchAgentService } from './services/search-agent.service';
import { OutfitGeneratorAgentService } from './services/outfit-generator-agent.service';
import { ChatOrchestratorService } from './services/chat-orchestrator.service';

// Controllers
import { ChatController } from './controllers/chat.controller';

// Database
import { Conversation, ConversationSchema } from './domain/schemas/conversation.schema';
import { ConversationRepository } from './infrastructure/persistence/conversation.repository';

/**
 * Agents Module
 *
 * Provides the multi-agent chat infrastructure for Elara.
 *
 * Architecture:
 * ┌────────────────────────────────────────────────┐
 * │         ChatOrchestratorService                │
 * │         (Main Coordinator)                     │
 * └─────────────────┬──────────────────────────────┘
 *                   │
 *          ┌────────┴────────┐
 *          │                 │
 *    ┌─────▼──────┐   ┌─────▼──────────────────────┐
 *    │   Intent   │   │   Agent Execution          │
 *    │   Router   │   │   • SearchAgent            │
 *    │            │   │   • OutfitGeneratorAgent   │
 *    └────────────┘   │   • FeedbackAgent          │
 *                     │   • ChatAgent              │
 *                     └────────────────────────────┘
 *
 * Agents:
 * - IntentRouter: Classifies user intent using Claude
 * - SearchAgent: Handles product search requests
 * - OutfitGeneratorAgent: Creates outfit combinations
 * - ChatOrchestrator: Coordinates all agents and manages conversation
 *
 * Dependencies:
 * - LlmModule: Claude/Gemini for intent classification and generation
 * - SearchModule: Product search infrastructure
 * - ConfigModule: Configuration management
 *
 * Exports:
 * - ChatOrchestratorService: Main entry point for chat interactions
 */
@Module({
  imports: [
    ConfigModule,
    LLMModule,
    SearchModule,
    ProductsModule,
    OutfitScoringModule, // For outfit scoring service
    AnalyticsModule,
    SearchHistoryModule,
    OnboardingModule, // For user profile access in chat (gender, size, preferences)
    WardrobeModule, // For wardrobe-based outfit generation
    ContextModule, // For constraint store and context services
    ReasoningModule, // For safety validation and fashion reasoning
    // MongoDB for conversation persistence
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
    ]),
  ],
  controllers: [
    ChatController,
  ],
  providers: [
    // Intent Classification
    IntentRouterService,

    // Specialized Agents
    SearchAgentService,
    OutfitGeneratorAgentService,

    // Main Coordinator
    ChatOrchestratorService,

    // Database Repository
    ConversationRepository,
  ],
  exports: [
    // Export main orchestrator as entry point
    ChatOrchestratorService,
    // Export repository for potential use in other modules
    ConversationRepository,
    // Export OutfitGeneratorAgentService for slot-level editing in ItemReplacementHandler
    OutfitGeneratorAgentService,
  ],
})
export class AgentsModule {}
