import { Injectable, Logger } from '@nestjs/common';
import { ClaudeService } from '../../infrastructure/llm/claude.service';
import { ConversationContext, ChatMessage } from '../dto/chat-message.dto';

/**
 * Intent Router Service
 *
 * Routes user messages to appropriate agents based on classified intent.
 * Uses Claude for intent classification with conversation context.
 *
 * Intent → Agent Mapping:
 * - product_search → SearchAgent
 * - outfit_request → OutfitGeneratorAgent
 * - single_item_search → SearchAgent
 * - item_replacement → OutfitGeneratorAgent
 * - feedback → FeedbackAgent
 * - general_chat → ChatAgent
 * - clarification_needed → ClarificationAgent
 */
@Injectable()
export class IntentRouterService {
  private readonly logger = new Logger(IntentRouterService.name);

  constructor(private claudeService: ClaudeService) {}

  /**
   * Route user message to appropriate agent
   */
  async route(
    message: string,
    context: ConversationContext,
    userContext?: any,
  ): Promise<RoutingDecision> {
    const startTime = Date.now();

    try {
      // Classify intent using Claude
      const classification = await this.claudeService.classifyIntent(
        message,
        this.formatHistory(context.history),
        userContext,
      );

      // Determine target agent
      const agent = this.mapIntentToAgent(classification.intent);

      // Check if clarification is needed
      const needsClarification =
        classification.intent === 'clarification_needed' ||
        classification.confidence < 0.7;

      const duration = Date.now() - startTime;

      this.logger.log(
        `Routed to ${agent}: "${message}" (intent: ${classification.intent}, confidence: ${classification.confidence}) in ${duration}ms`,
      );

      return {
        agent,
        intent: classification.intent,
        confidence: classification.confidence,
        filters: classification.filters,
        needsClarification,
        clarificationFields: classification.clarificationNeeded,
        reasoning: classification.reasoning,
        processingTime: duration,
      };
    } catch (error) {
      this.logger.error(`Intent routing failed: ${(error as Error).message}`);

      // Fallback to general chat
      return {
        agent: AgentType.CHAT,
        intent: 'general_chat',
        confidence: 0.5,
        filters: {},
        needsClarification: false,
        reasoning: 'Fallback due to routing error',
        processingTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Map intent to agent type
   */
  private mapIntentToAgent(intent: string): AgentType {
    const mapping: Record<string, AgentType> = {
      product_search: AgentType.SEARCH,
      single_item_search: AgentType.SEARCH,
      outfit_request: AgentType.OUTFIT_GENERATOR,
      item_replacement: AgentType.OUTFIT_GENERATOR,
      feedback: AgentType.FEEDBACK,
      general_chat: AgentType.CHAT,
      fashion_advice: AgentType.FASHION_ADVICE,
      clarification_needed: AgentType.CLARIFICATION,
    };

    return mapping[intent] || AgentType.CHAT;
  }

  /**
   * Format conversation history for Claude
   */
  private formatHistory(
    history: ChatMessage[],
  ): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
    // Take last 5 messages for context
    return history.slice(-5).map((msg) => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));
  }

  /**
   * Check if user is changing topic mid-conversation
   */
  isTopicChange(
    currentIntent: string,
    previousIntent?: string,
  ): boolean {
    if (!previousIntent) return false;

    // Topic changes:
    // - outfit_request → product_search
    // - product_search → outfit_request
    // - Any intent → feedback (not a change, continue)

    const majorIntents = ['product_search', 'outfit_request', 'single_item_search'];

    const currentIsMajor = majorIntents.includes(currentIntent);
    const previousIsMajor = majorIntents.includes(previousIntent);

    // Both major intents but different
    if (currentIsMajor && previousIsMajor && currentIntent !== previousIntent) {
      return true;
    }

    return false;
  }

  /**
   * Generate clarification question using Claude
   */
  async generateClarification(
    message: string,
    missingFields: string[],
    userContext?: any,
  ): Promise<string> {
    try {
      return await this.claudeService.generateClarification(
        message,
        missingFields,
        userContext,
      );
    } catch (error) {
      this.logger.error(
        `Clarification generation failed: ${(error as Error).message}`,
      );
      return "I'd love to help! Could you tell me a bit more about what you're looking for?";
    }
  }
}

/**
 * Agent types
 */
export enum AgentType {
  SEARCH = 'search',
  OUTFIT_GENERATOR = 'outfit_generator',
  FEEDBACK = 'feedback',
  CHAT = 'chat',
  FASHION_ADVICE = 'fashion_advice',
  CLARIFICATION = 'clarification',
}

/**
 * Routing decision
 */
export interface RoutingDecision {
  agent: AgentType;
  intent: string;
  confidence: number;
  filters: Record<string, any>;
  needsClarification: boolean;
  clarificationFields?: string[];
  reasoning: string;
  processingTime: number;
}
