import { Injectable, Logger, Optional } from '@nestjs/common';
import { IntentRouterService, AgentType } from './intent-router.service';
import { SearchAgentService } from './search-agent.service';
import { OutfitGeneratorAgentService } from './outfit-generator-agent.service';
import { GeminiService } from '../../infrastructure/llm/gemini.service';
import {
  ConversationContext,
  ChatMessage,
  AgentResponse,
  ResponseType,
  AgentResult,
} from '../dto/chat-message.dto';
import { v4 as uuidv4 } from 'uuid';
import { AnalyticsService } from '../../analytics/analytics.service';

/**
 * Chat Orchestrator Service
 *
 * Main coordinator for the chat pipeline. Orchestrates the flow:
 * User Message → Intent Router → Agent → Response
 *
 * Responsibilities:
 * - Manage conversation context
 * - Route messages to appropriate agents
 * - Handle clarifications
 * - Track conversation state
 * - Track analytics events
 * - Provide fallback responses
 *
 * This is the main entry point for all chat interactions.
 */
@Injectable()
export class ChatOrchestratorService {
  private readonly logger = new Logger(ChatOrchestratorService.name);

  constructor(
    private intentRouter: IntentRouterService,
    private searchAgent: SearchAgentService,
    private outfitGenerator: OutfitGeneratorAgentService,
    private geminiService: GeminiService,
    @Optional() private analyticsService?: AnalyticsService,
  ) {}

  /**
   * Process user message
   * Main entry point for chat interactions
   */
  async processMessage(
    message: string,
    context: ConversationContext,
    userContext?: any,
  ): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      // Step 1: Route message to appropriate agent
      const routing = await this.intentRouter.route(
        message,
        context,
        userContext,
      );

      this.logger.log(
        `Processing message: "${message}" → ${routing.agent} (confidence: ${routing.confidence})`,
      );

      // Step 2: Handle clarification if needed
      if (routing.needsClarification) {
        return await this.handleClarification(
          message,
          routing,
          context,
          userContext,
        );
      }

      // Step 3: Execute appropriate agent
      const response = await this.executeAgent(
        routing.agent,
        message,
        routing,
        userContext,
        context, // Pass context for item_replacement handling
      );

      // Step 4: Update conversation context
      const updatedContext = this.updateContext(
        context,
        message,
        response,
        routing,
      );

      // Step 5: Track analytics (non-blocking)
      const duration = Date.now() - startTime;
      this.trackChatAnalytics(
        context.userId,
        message,
        routing,
        response,
        duration,
      );

      // Step 6: Return result
      const result: AgentResult = {
        success: true,
        response,
        conversationContext: updatedContext,
      };

      this.logger.log(
        `Message processed successfully in ${duration}ms (agent: ${routing.agent})`,
      );

      return result;
    } catch (error) {
      this.logger.error(
        `Message processing failed: ${(error as Error).message}`,
      );

      // Return graceful error response
      return {
        success: false,
        response: this.buildErrorResponse(),
        conversationContext: this.updateContextWithError(context, message),
        error: (error as Error).message,
      };
    }
  }

  /**
   * Execute agent based on routing decision
   */
  private async executeAgent(
    agent: AgentType,
    message: string,
    routing: any,
    userContext?: any,
    context?: ConversationContext,
  ): Promise<AgentResponse> {
    switch (agent) {
      case AgentType.SEARCH:
        return await this.searchAgent.execute(message, routing, userContext);

      case AgentType.OUTFIT_GENERATOR:
        // CRITICAL FIX: Check if this is an item_replacement intent
        // If so, use replaceOutfitItem() instead of generating new outfits
        if (routing.intent === 'item_replacement' && context) {
          return await this.handleItemReplacement(message, routing, userContext, context);
        }
        return await this.outfitGenerator.execute(
          message,
          routing,
          userContext,
        );

      case AgentType.FEEDBACK:
        return this.handleFeedback(message, routing);

      case AgentType.CHAT:
        return await this.handleGeneralChat(message, routing, userContext);

      case AgentType.FASHION_ADVICE:
        return await this.handleFashionAdvice(message, routing, userContext);

      case AgentType.CLARIFICATION:
        // Shouldn't reach here as clarifications are handled separately
        return this.buildClarificationResponse(message, []);

      default:
        this.logger.warn(`Unknown agent type: ${agent}`);
        return await this.handleGeneralChat(message, routing, userContext);
    }
  }

  /**
   * Handle clarification requests
   */
  private async handleClarification(
    message: string,
    routing: any,
    context: ConversationContext,
    userContext?: any,
  ): Promise<AgentResult> {
    // Generate clarification question
    const clarificationMessage =
      await this.intentRouter.generateClarification(
        message,
        routing.clarificationFields || [],
        userContext,
      );

    const response: AgentResponse = {
      message: clarificationMessage,
      type: ResponseType.CLARIFICATION,
      metadata: {
        intent: routing.intent,
        confidence: routing.confidence,
        agentUsed: 'clarification',
        processingTime: routing.processingTime,
      },
    };

    // Update context to indicate awaiting clarification
    const updatedContext = { ...context };
    updatedContext.awaitingClarification = true;
    updatedContext.currentIntent = routing.intent;
    updatedContext.history.push({
      id: uuidv4(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    });
    updatedContext.history.push({
      id: uuidv4(),
      role: 'assistant',
      content: clarificationMessage,
      timestamp: new Date(),
    });

    return {
      success: true,
      response,
      conversationContext: updatedContext,
    };
  }

  /**
   * Handle feedback messages
   */
  private handleFeedback(message: string, routing: any): AgentResponse {
    // Extract feedback type (like/dislike)
    const isPositive = this.extractFeedbackSentiment(message);

    return {
      message: isPositive
        ? "Thanks for the feedback! I'm glad you like it. Can I help you with anything else?"
        : "Thanks for letting me know. Let me try to find something better for you.",
      type: ResponseType.TEXT,
      metadata: {
        intent: routing.intent,
        confidence: routing.confidence,
        agentUsed: 'feedback',
        processingTime: 0,
      },
      suggestedActions: isPositive
        ? [
            {
              label: 'Find similar items',
              action: 'find_similar',
            },
            {
              label: 'Create outfit with this',
              action: 'create_outfit',
            },
          ]
        : [
            {
              label: 'Refine search',
              action: 'refine_search',
            },
            {
              label: 'Try different style',
              action: 'new_search',
            },
          ],
    };
  }

  /**
   * Handle general chat messages using Gemini 3 Pro
   * Also handles off-topic queries by redirecting to fashion
   */
  private async handleGeneralChat(
    message: string,
    routing: any,
    userContext?: any,
  ): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      // Check if this is an off-topic query (reasoning will indicate it)
      const isOffTopic = routing.reasoning?.toLowerCase().includes('off-topic') ||
        this.isOffTopicQuery(message);

      if (isOffTopic) {
        const processingTime = Date.now() - startTime;
        return {
          message: this.generateOffTopicResponse(message),
          type: ResponseType.TEXT,
          metadata: {
            intent: routing.intent,
            confidence: routing.confidence,
            agentUsed: 'off-topic-handler',
            processingTime,
            isOffTopic: true,
          },
          suggestedActions: [
            {
              label: 'Search for clothes',
              action: 'start_search',
            },
            {
              label: 'Get outfit ideas',
              action: 'create_outfit',
            },
            {
              label: 'Get styling advice',
              action: 'fashion_advice',
            },
          ],
        };
      }

      // Use Gemini for intelligent chat responses
      const response = await this.geminiService.generateChatResponse(
        message,
        [], // Empty history for now - could pass context.history if needed
        userContext,
      );

      const processingTime = Date.now() - startTime;

      return {
        message: response,
        type: ResponseType.TEXT,
        metadata: {
          intent: routing.intent,
          confidence: routing.confidence,
          agentUsed: 'gemini-chat',
          processingTime,
        },
        suggestedActions: [
          {
            label: 'Search for products',
            action: 'start_search',
          },
          {
            label: 'Build an outfit',
            action: 'create_outfit',
          },
        ],
      };
    } catch (error) {
      this.logger.error('Gemini chat failed, using fallback', error);

      // Fallback to simple responses if Gemini fails
      return {
        message: this.generateFallbackChatResponse(message),
        type: ResponseType.TEXT,
        metadata: {
          intent: routing.intent,
          confidence: routing.confidence,
          agentUsed: 'chat-fallback',
          processingTime: Date.now() - startTime,
        },
        suggestedActions: [
          {
            label: 'Search for products',
            action: 'start_search',
          },
          {
            label: 'Build an outfit',
            action: 'create_outfit',
          },
        ],
      };
    }
  }

  /**
   * Check if a query is off-topic (not about fashion)
   */
  private isOffTopicQuery(message: string): boolean {
    const messageLower = message.toLowerCase();

    // Tech/AI keywords
    const techKeywords = [
      'api', 'model id', 'gemini', 'gpt', 'claude', 'openai', 'google ai',
      'programming', 'code', 'software', 'developer', 'javascript', 'python',
      'database', 'server', 'algorithm', 'machine learning', 'neural network',
      'crypto', 'bitcoin', 'blockchain', 'nft',
    ];

    // Other off-topic categories
    const offTopicKeywords = [
      'recipe', 'cooking', 'restaurant', 'food',
      'hotel', 'flight', 'vacation', 'tourist',
      'movie', 'song', 'music', 'game', 'gaming',
      'stock', 'invest', 'trading', 'finance',
      'medical', 'doctor', 'health', 'symptom',
      'politics', 'election', 'government',
      'math', 'physics', 'chemistry', 'science',
    ];

    const allOffTopicKeywords = [...techKeywords, ...offTopicKeywords];

    // Check if message contains off-topic keywords
    const hasOffTopicKeyword = allOffTopicKeywords.some(keyword =>
      messageLower.includes(keyword)
    );

    // Also check if the message has NO fashion-related words
    const fashionKeywords = [
      'wear', 'outfit', 'dress', 'shirt', 'pants', 'shoes', 'jacket',
      'style', 'fashion', 'clothes', 'clothing', 'accessory', 'bag',
      'look', 'color', 'match', 'fit', 'size', 'brand', 'shop', 'buy',
    ];

    const hasFashionKeyword = fashionKeywords.some(keyword =>
      messageLower.includes(keyword)
    );

    // If has off-topic keyword AND no fashion keyword, it's off-topic
    return hasOffTopicKeyword && !hasFashionKeyword;
  }

  /**
   * Generate a friendly response for off-topic queries
   */
  private generateOffTopicResponse(message: string): string {
    const messageLower = message.toLowerCase();

    // Detect what kind of off-topic it is for a more personalized response
    if (messageLower.includes('api') || messageLower.includes('model') ||
        messageLower.includes('gemini') || messageLower.includes('gpt') ||
        messageLower.includes('code') || messageLower.includes('programming')) {
      return "I'm Elara, your personal fashion assistant! While I can't help with tech or AI questions, I'm an expert at helping you find the perfect outfit, discover new styles, and build a wardrobe you'll love. What can I help you with today - are you looking for something specific to wear?";
    }

    if (messageLower.includes('food') || messageLower.includes('recipe') ||
        messageLower.includes('restaurant')) {
      return "I'm Elara, your fashion stylist! I'm all about clothes and style rather than food. But I'd love to help you pick an outfit - maybe something for a dinner date? What occasion are you dressing for?";
    }

    if (messageLower.includes('travel') || messageLower.includes('hotel') ||
        messageLower.includes('vacation')) {
      return "I'm Elara, your personal style assistant! While I can't help with travel planning, I'm great at helping you pack the perfect vacation wardrobe. Planning a trip? I can help you pick versatile outfits that work for any destination!";
    }

    // Generic off-topic response
    return "I'm Elara, your AI fashion assistant! I specialize in helping you discover clothes, create outfits, and develop your personal style. I can't help with that particular topic, but I'd love to assist with anything fashion-related. Looking for something to wear, or want some styling advice?";
  }

  /**
   * Handle fashion advice requests using Gemini 3 Pro
   * For general styling tips/advice without triggering product searches
   */
  private async handleFashionAdvice(
    message: string,
    routing: any,
    userContext?: any,
  ): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      const profile = userContext?.profile || {};

      // Build a fashion-advice-specific prompt
      const fashionPrompt = `You are Elara, an expert fashion stylist providing personalized advice.

USER PROFILE:
- Gender: ${profile.gender || 'not specified'}
- Primary Style: ${profile.primaryStyle || 'versatile'}
- Style Influences: ${profile.selectedStyles?.join(', ') || 'open to all styles'}
- Color Preferences: ${profile.colorPreferences?.join(', ') || 'no specific preference'}
- Colors to Avoid: ${profile.avoidColors?.join(', ') || 'none'}

The user is asking for GENERAL fashion advice, NOT looking to browse products.

QUESTION: "${message}"

GUIDELINES:
- Give specific, actionable styling advice based on color theory and fashion principles
- Consider their style preferences and any colors to avoid
- Be warm and conversational, not robotic
- Keep response concise but helpful (3-5 sentences)
- You can mention that if they want to see specific products, they can ask you to search
- Use fashion expertise: complementary colors, silhouettes, styling techniques`;

      const response = await this.geminiService.generateChatResponse(
        fashionPrompt,
        [],
        userContext,
      );

      const processingTime = Date.now() - startTime;

      return {
        message: response,
        type: ResponseType.TEXT,
        metadata: {
          intent: routing.intent,
          confidence: routing.confidence,
          agentUsed: 'gemini-fashion-advice',
          processingTime,
        },
        suggestedActions: [
          {
            label: 'Show me products',
            action: 'start_search',
          },
          {
            label: 'Create an outfit',
            action: 'create_outfit',
          },
        ],
      };
    } catch (error) {
      this.logger.error('Fashion advice generation failed', error);

      // Fallback response
      return {
        message: this.generateFallbackFashionAdvice(message),
        type: ResponseType.TEXT,
        metadata: {
          intent: routing.intent,
          confidence: routing.confidence,
          agentUsed: 'fashion-advice-fallback',
          processingTime: Date.now() - startTime,
        },
        suggestedActions: [
          {
            label: 'Show me products',
            action: 'start_search',
          },
        ],
      };
    }
  }

  /**
   * Generate fallback fashion advice when Gemini fails
   */
  private generateFallbackFashionAdvice(message: string): string {
    const messageLower = message.toLowerCase();

    // Color-related questions
    if (messageLower.includes('red')) {
      return 'Red is a bold statement color! It pairs beautifully with neutrals like white, black, navy, and beige. For a sophisticated look, try burgundy or cream. Avoid combining with bright orange or pink. Would you like me to find specific pieces?';
    }

    if (messageLower.includes('blue') || messageLower.includes('navy')) {
      return 'Blue is incredibly versatile! Navy works with almost everything - white, cream, tan, coral, and even mustard yellow. Light blue pairs well with white, gray, and blush pink. Would you like me to search for complementary pieces?';
    }

    if (messageLower.includes('black')) {
      return "Black is the ultimate neutral - it pairs with literally everything! For a polished look, try black with white, camel, or jewel tones like emerald or burgundy. Metallics like gold and silver also pop beautifully against black. Shall I find some options?";
    }

    // General styling fallback
    return "Great question! When styling any piece, consider the color wheel - complementary colors (opposite on the wheel) create bold looks, while analogous colors (next to each other) feel harmonious. Neutrals like black, white, beige, and navy are always safe choices. Would you like me to search for specific items that match what you have in mind?";
  }

  /**
   * Generate fallback chat response when Gemini fails
   */
  private generateFallbackChatResponse(message: string): string {
    const messageLower = message.toLowerCase();

    // Greetings
    if (
      messageLower.includes('hi') ||
      messageLower.includes('hello') ||
      messageLower.includes('hey')
    ) {
      return "Hi! I'm Elara, your AI fashion assistant. I can help you find clothes, create outfits, and discover your perfect style. What are you looking for today?";
    }

    // Help requests
    if (
      messageLower.includes('help') ||
      messageLower.includes('what can you')
    ) {
      return "I can help you:\n• Find specific clothing items\n• Create complete outfit recommendations\n• Discover products that match your style\n• Get fashion advice\n\nJust tell me what you're looking for!";
    }

    // Default
    return "I'm here to help you find great fashion! You can ask me to search for specific items, create outfits for occasions, or just chat about style. What would you like to do?";
  }

  /**
   * Extract feedback sentiment
   */
  private extractFeedbackSentiment(message: string): boolean {
    const messageLower = message.toLowerCase();

    const positiveWords = ['like', 'love', 'great', 'perfect', 'amazing', 'beautiful'];
    const negativeWords = ['dislike', 'hate', 'not', "don't", 'bad', 'ugly'];

    const hasPositive = positiveWords.some((word) =>
      messageLower.includes(word),
    );
    const hasNegative = negativeWords.some((word) =>
      messageLower.includes(word),
    );

    return hasPositive && !hasNegative;
  }

  /**
   * Build clarification response
   */
  private buildClarificationResponse(
    message: string,
    fields: string[],
  ): AgentResponse {
    return {
      message: "I'd love to help! Could you tell me a bit more about what you're looking for?",
      type: ResponseType.CLARIFICATION,
      metadata: {
        intent: 'clarification_needed',
        confidence: 0.5,
        agentUsed: 'clarification',
        processingTime: 0,
      },
    };
  }

  /**
   * Build error response
   */
  private buildErrorResponse(): AgentResponse {
    return {
      message: "I'm having trouble processing your message right now. Could you try rephrasing?",
      type: ResponseType.ERROR,
      metadata: {
        intent: 'error',
        confidence: 0,
        agentUsed: 'error_handler',
        processingTime: 0,
      },
    };
  }

  /**
   * Update conversation context
   */
  private updateContext(
    context: ConversationContext,
    userMessage: string,
    response: AgentResponse,
    routing: any,
  ): ConversationContext {
    const updatedContext = { ...context };

    // Add user message
    updatedContext.history.push({
      id: uuidv4(),
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
      metadata: {
        intent: routing.intent,
        confidence: routing.confidence,
      },
    });

    // Add assistant response
    updatedContext.history.push({
      id: uuidv4(),
      role: 'assistant',
      content: response.message,
      timestamp: new Date(),
      metadata: {
        agentUsed: response.metadata?.agentUsed,
        processingTime: response.metadata?.processingTime,
      },
    });

    // Update metadata
    updatedContext.currentIntent = routing.intent;
    updatedContext.awaitingClarification = false;
    updatedContext.metadata = {
      ...updatedContext.metadata,
      startedAt: updatedContext.metadata?.startedAt || new Date(),
      lastMessageAt: new Date(),
      messageCount: updatedContext.history.length,
    };

    // Trim history if too long (keep last 20 messages)
    if (updatedContext.history.length > 20) {
      updatedContext.history = updatedContext.history.slice(-20);
    }

    return updatedContext;
  }

  /**
   * Update context with error
   */
  private updateContextWithError(
    context: ConversationContext,
    userMessage: string,
  ): ConversationContext {
    const updatedContext = { ...context };

    updatedContext.history.push({
      id: uuidv4(),
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    });

    return updatedContext;
  }

  /**
   * Create new conversation context
   */
  createNewContext(userId: string, sessionId?: string): ConversationContext {
    return {
      conversationId: uuidv4(),
      userId,
      sessionId: sessionId || uuidv4(),
      history: [],
      metadata: {
        startedAt: new Date(),
        lastMessageAt: new Date(),
        messageCount: 0,
      },
    };
  }

  /**
   * Track chat analytics (non-blocking)
   */
  private trackChatAnalytics(
    userId: string,
    message: string,
    routing: any,
    response: AgentResponse,
    processingTime: number,
  ): void {
    if (!this.analyticsService) return;

    // Track chat message event
    const messageId = uuidv4();
    this.analyticsService.trackChatMessage(
      userId,
      messageId,
      routing.intent,
      routing.agent,
      processingTime,
    );

    // If this was a search, also track search event
    if (routing.agent === AgentType.SEARCH && response.data?.products) {
      this.analyticsService.trackSearch(
        userId,
        message,
        response.data.products.length,
        routing.filters,
        response.metadata?.sources,
        processingTime,
      );
    }
  }

  /**
   * Handle item replacement requests
   * CRITICAL FIX: This method replaces ONLY the specified item in an outfit,
   * preserving all other items instead of regenerating 3 new outfits.
   *
   * Example: "in 2nd outfit change shoes to formals"
   * - Parses which outfit (2nd) and which slot (shoes)
   * - Gets the previous outfit from context
   * - Calls outfitGenerator.replaceOutfitItem() to find replacements
   * - Returns the SAME outfit with ONLY the shoes changed
   */
  private async handleItemReplacement(
    message: string,
    routing: any,
    userContext: any,
    context: ConversationContext,
  ): Promise<AgentResponse> {
    const startTime = Date.now();

    try {
      this.logger.log(`[ItemReplacement] Processing: "${message}"`);

      // Step 1: Parse the replacement request
      const parsed = this.parseReplacementRequest(message);

      if (!parsed) {
        return {
          message: "I couldn't understand which item you'd like to replace. Could you specify the item (shoes, top, bottom, etc.) and which outfit (1, 2, or 3)?",
          type: ResponseType.TEXT,
          metadata: {
            intent: routing.intent,
            confidence: routing.confidence,
            agentUsed: 'item-replacement',
            processingTime: Date.now() - startTime,
          },
        };
      }

      const { outfitIndex, slotToReplace, constraints } = parsed;

      // Step 2: Get previous outfits from context
      const previousOutfits = context.metadata?.lastOutfits || [];

      if (previousOutfits.length === 0) {
        return {
          message: "I don't have any previous outfits to modify. Would you like me to create some outfit recommendations first?",
          type: ResponseType.TEXT,
          metadata: {
            intent: routing.intent,
            confidence: routing.confidence,
            agentUsed: 'item-replacement',
            processingTime: Date.now() - startTime,
          },
          suggestedActions: [
            { label: 'Create outfits', action: 'create_outfit' },
          ],
        };
      }

      if (outfitIndex < 0 || outfitIndex >= previousOutfits.length) {
        return {
          message: `I only have ${previousOutfits.length} outfit(s) to work with. Please specify outfit 1${previousOutfits.length > 1 ? ` to ${previousOutfits.length}` : ''}.`,
          type: ResponseType.TEXT,
          metadata: {
            intent: routing.intent,
            confidence: routing.confidence,
            agentUsed: 'item-replacement',
            processingTime: Date.now() - startTime,
          },
        };
      }

      const targetOutfit = previousOutfits[outfitIndex];
      const outfitId = targetOutfit.id || `outfit_${outfitIndex + 1}`;

      this.logger.log(`[ItemReplacement] Replacing "${slotToReplace}" in outfit ${outfitIndex + 1}`);

      // Step 3: Call the replaceOutfitItem method
      const replacementResult = await this.outfitGenerator.replaceOutfitItem(
        outfitId,
        slotToReplace,
        userContext,
        constraints,
      );

      // Step 4: Build updated outfit preserving all other items
      const updatedOutfit = this.buildUpdatedOutfit(
        targetOutfit,
        slotToReplace,
        replacementResult.bestReplacement,
      );

      // Step 5: Format response
      const processingTime = Date.now() - startTime;
      const replacedItemName = replacementResult.bestReplacement?.title || 'new item';

      return {
        message: `I've updated Outfit ${outfitIndex + 1} with a new ${slotToReplace}: **${replacedItemName}**. Here's your updated outfit:`,
        type: ResponseType.OUTFIT_RECOMMENDATIONS,
        data: {
          outfits: [updatedOutfit],
          replacedSlot: slotToReplace,
          alternatives: replacementResult.alternatives?.slice(0, 3).map((p: any) => ({
            product_id: p.id,
            name: p.title,
            price: p.price ? `$${p.price.toFixed(2)}` : 'Price unavailable',
            url: p.productUrl,
            image_url: p.imageUrl,
            retailer: p.retailer,
            brand: p.brand,
          })),
        },
        metadata: {
          intent: routing.intent,
          confidence: routing.confidence,
          agentUsed: 'item-replacement',
          processingTime,
        },
        suggestedActions: [
          { label: 'Try another option', action: 'replace_item', data: { slot: slotToReplace } },
          { label: 'Change another item', action: 'replace_item' },
        ],
      };
    } catch (error) {
      this.logger.error(`[ItemReplacement] Failed: ${(error as Error).message}`);

      return {
        message: "I had trouble finding a replacement. Would you like me to search for alternatives?",
        type: ResponseType.TEXT,
        metadata: {
          intent: routing.intent,
          confidence: routing.confidence,
          agentUsed: 'item-replacement-error',
          processingTime: Date.now() - startTime,
        },
        suggestedActions: [
          { label: 'Search for alternatives', action: 'start_search' },
        ],
      };
    }
  }

  /**
   * Parse item replacement request from user message
   * Examples:
   * - "in 2nd outfit change shoes to formals" → outfit 1 (0-indexed), slot: shoes
   * - "replace the top in outfit 1" → outfit 0, slot: top
   * - "different shoes" → outfit 0, slot: shoes (defaults to first outfit)
   */
  private parseReplacementRequest(message: string): {
    outfitIndex: number;
    slotToReplace: string;
    constraints: any;
  } | null {
    const messageLower = message.toLowerCase();

    // Extract outfit number (default to 0 if not specified)
    let outfitIndex = 0;
    const outfitPatterns = [
      /outfit\s*(\d+)/i,
      /(\d+)(?:st|nd|rd|th)\s*outfit/i,
      /in\s*(\d+)(?:st|nd|rd|th)/i,
      /option\s*(\d+)/i,
    ];

    for (const pattern of outfitPatterns) {
      const match = messageLower.match(pattern);
      if (match) {
        outfitIndex = parseInt(match[1], 10) - 1; // Convert to 0-indexed
        break;
      }
    }

    // Extract slot to replace
    const slotKeywords: Record<string, string[]> = {
      shoes: ['shoes', 'shoe', 'footwear', 'sneakers', 'boots', 'heels', 'sandals', 'loafers', 'flats', 'formals', 'formal shoes', 'oxford', 'oxfords'],
      top: ['top', 'shirt', 'blouse', 'tee', 't-shirt', 'sweater', 'cardigan', 'hoodie'],
      bottom: ['bottom', 'pants', 'jeans', 'trousers', 'skirt', 'shorts'],
      dress: ['dress', 'gown'],
      outerwear: ['jacket', 'coat', 'blazer', 'outerwear', 'cardigan'],
      accessories: ['accessories', 'accessory', 'bag', 'belt', 'jewelry', 'watch', 'sunglasses'],
    };

    let slotToReplace: string | null = null;

    for (const [slot, keywords] of Object.entries(slotKeywords)) {
      if (keywords.some((kw) => messageLower.includes(kw))) {
        slotToReplace = slot;
        break;
      }
    }

    if (!slotToReplace) {
      return null;
    }

    // Extract any constraints (e.g., "to formals", "black", "leather")
    const constraints: any = {};

    // Style constraints
    if (messageLower.includes('formal') || messageLower.includes('dressy')) {
      constraints.style = 'formal';
    } else if (messageLower.includes('casual') || messageLower.includes('relaxed')) {
      constraints.style = 'casual';
    }

    // Color constraints
    const colorWords = ['black', 'white', 'brown', 'tan', 'navy', 'blue', 'red', 'green', 'gray', 'grey'];
    for (const color of colorWords) {
      if (messageLower.includes(color)) {
        constraints.color = color;
        break;
      }
    }

    return { outfitIndex, slotToReplace, constraints };
  }

  /**
   * Build updated outfit with replaced item
   * Preserves all other items, only replaces the specified slot
   */
  private buildUpdatedOutfit(
    originalOutfit: any,
    slotToReplace: string,
    newItem: any,
  ): any {
    if (!newItem) {
      return originalOutfit;
    }

    // Map slot names for matching (handle variations)
    const slotVariations: Record<string, string[]> = {
      shoes: ['shoes', 'footwear', 'sneakers', 'boots', 'heels'],
      top: ['top', 'shirt', 'blouse', 'sweater'],
      bottom: ['bottom', 'pants', 'jeans', 'trousers', 'skirt'],
      dress: ['dress', 'gown'],
      outerwear: ['outerwear', 'jacket', 'coat', 'blazer'],
      accessories: ['accessories', 'accessory', 'bag', 'watch', 'belt'],
    };

    // Find which slot variations match
    const normalizedSlot = slotToReplace.toLowerCase();
    let targetSlots = [normalizedSlot];
    for (const [baseSlot, variations] of Object.entries(slotVariations)) {
      if (variations.includes(normalizedSlot) || baseSlot === normalizedSlot) {
        targetSlots = variations;
        break;
      }
    }

    // Create new items array with the replacement
    const updatedItems = (originalOutfit.items || []).map((item: any) => {
      const itemSlot = (item.slot || item.category || '').toLowerCase();

      // Check if this item should be replaced
      if (targetSlots.includes(itemSlot)) {
        return {
          slot: slotToReplace,
          category: slotToReplace,
          productId: newItem.id,
          name: newItem.title,
          price: newItem.price ? `$${newItem.price.toFixed(2)}` : item.price,
          url: newItem.productUrl,
          image_url: newItem.imageUrl,
          retailer: newItem.retailer,
          brand: newItem.brand,
          isReplacement: true,
        };
      }

      return item;
    });

    // Recalculate total price
    let totalPrice = 0;
    for (const item of updatedItems) {
      const priceStr = item.price || '$0';
      const price = parseFloat(priceStr.replace(/[$,]/g, '')) || 0;
      totalPrice += price;
    }

    return {
      ...originalOutfit,
      items: updatedItems,
      total_price: `$${totalPrice.toFixed(2)}`,
      reasoning: `Updated with new ${slotToReplace}.`,
    };
  }
}
