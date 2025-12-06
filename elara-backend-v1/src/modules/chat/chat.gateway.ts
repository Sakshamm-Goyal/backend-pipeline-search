import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SendMessageDto } from './dto/send-message.dto';

// Handler pattern with streaming
import { HandlerDispatcherService } from './handlers/handler-dispatcher.service';
import { ChatChunk, UserContext } from './handlers/handler.interface';
import { ConversationContext } from '../pipeline/agents/dto/chat-message.dto';
import { SearchFilters } from '../pipeline/search/dto/search-query.dto';

// User profile access
import { OnboardingService } from '../onboarding/application/services/onboarding.service';
import { ProductFeedback } from './domain/schemas/feedback.schema';

/**
 * Chat Gateway
 *
 * WebSocket gateway for real-time chat interactions.
 * Uses Handler Pattern with RxJS Observable streaming.
 *
 * Events:
 * - chat:message - Process user message
 * - chat:typing - Typing indicator
 * - chat:stream - Streaming text response
 * - chat:stream:status - Status updates
 * - chat:stream:end - Final response with data
 * - chat:error - Error notification
 * - chat:feedback - Product feedback
 */
@WebSocketGateway({
  cors: {
    origin: process.env.WS_CORS_ORIGIN || 'http://localhost:3001',
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  // In-memory conversation contexts (could be moved to Redis for scaling)
  private conversationContexts = new Map<string, ConversationContext>();

  constructor(
    private readonly handlerDispatcher: HandlerDispatcherService,
    private readonly onboardingService: OnboardingService,
    private readonly configService: ConfigService,
    @InjectModel(ProductFeedback.name)
    private readonly feedbackModel: Model<ProductFeedback>,
  ) {}

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Clean up conversation context on disconnect
    this.conversationContexts.delete(client.id);
  }

  @SubscribeMessage('chat:message')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessageDto,
  ) {
    const { message, sessionId, userId, filters } = payload;
    const startTime = Date.now();

    try {
      // Emit typing indicator
      client.emit('chat:typing', { isTyping: true });

      // Get or create conversation context
      const contextKey = `${userId}:${sessionId}`;
      let context = this.conversationContexts.get(contextKey);

      if (!context) {
        context = this.createNewContext(userId, sessionId);
        this.conversationContexts.set(contextKey, context);
      }

      // Add user message to history
      context.history.push({
        id: `msg_${Date.now()}_user`,
        role: 'user',
        content: message,
        timestamp: new Date(),
      });

      // Get user profile for personalization
      const userContext = await this.getUserContext(userId);

      // Parse search filters from payload
      const searchFilters = this.parseFilters(filters);

      // Track accumulated text and data for final response
      let accumulatedText = '';
      let finalData: any = {};

      // Process message through handler dispatcher with streaming
      const stream$ = this.handlerDispatcher.processMessage(
        message,
        context,
        searchFilters,
        userContext,
      );

      // Subscribe to stream and emit chunks
      stream$.subscribe({
        next: (chunk: ChatChunk) => {
          this.handleChunk(client, chunk, (text) => {
            accumulatedText += text;
          }, (data) => {
            finalData = { ...finalData, ...data };
          });
        },
        error: (error) => {
          this.logger.error('Stream error:', error);
          client.emit('chat:error', {
            message: error.message || 'An error occurred',
          });
          client.emit('chat:typing', { isTyping: false });
        },
        complete: () => {
          const processingTime = Date.now() - startTime;

          // Add assistant response to history
          context!.history.push({
            id: `msg_${Date.now()}_assistant`,
            role: 'assistant',
            content: accumulatedText,
            timestamp: new Date(),
          });

          // Store outfits/products in context for follow-up questions
          if (finalData.outfits) {
            context!.metadata = context!.metadata || {};
            context!.metadata.lastOutfits = finalData.outfits;
          }
          if (finalData.products) {
            context!.metadata = context!.metadata || {};
            context!.metadata.lastProducts = finalData.products;
          }

          // Update stored context
          this.conversationContexts.set(contextKey, context!);

          // Emit completion with metadata
          client.emit('chat:stream:end', {
            text: accumulatedText,
            data: finalData,
            metadata: {
              totalProcessingTime: processingTime,
            },
            done: true,
          });

          client.emit('chat:typing', { isTyping: false });

          this.logger.log(`Message processed in ${processingTime}ms`);
        },
      });
    } catch (error) {
      this.logger.error('Message handling error:', error);
      client.emit('chat:error', {
        message: (error as Error).message || 'An error occurred',
      });
      client.emit('chat:typing', { isTyping: false });
    }
  }

  /**
   * Handle individual chat chunks from the stream
   */
  private handleChunk(
    client: Socket,
    chunk: ChatChunk,
    onText: (text: string) => void,
    onData: (data: any) => void,
  ): void {
    switch (chunk.type) {
      case 'text':
        if (chunk.text) {
          onText(chunk.text);
          client.emit('chat:stream', {
            text: chunk.text,
            done: chunk.done || false,
          });
        }
        break;

      case 'status':
        client.emit('chat:stream:status', {
          status: chunk.status,
          text: chunk.text,
        });
        break;

      case 'data':
        if (chunk.data) {
          onData(chunk.data);
          // Emit data chunk for real-time UI updates
          client.emit('chat:stream:data', {
            data: chunk.data,
            done: chunk.done || false,
          });
        }
        break;
    }
  }

  /**
   * Create a new conversation context
   */
  private createNewContext(userId: string, sessionId: string): ConversationContext {
    return {
      userId,
      sessionId,
      history: [],
      metadata: {},
      preferences: {},
    };
  }

  /**
   * Get user context from profile
   */
  private async getUserContext(userId: string): Promise<UserContext> {
    try {
      const userProfile = await this.onboardingService.getProfile(userId);
      if (userProfile) {
        return {
          profile: {
            gender: userProfile.gender,
            primaryStyle: userProfile.stylePreferences?.primaryStyle,
            selectedStyles: userProfile.stylePreferences?.selectedStyles,
            colorPreferences: userProfile.stylePreferences?.colorPreferences,
            avoidColors: userProfile.stylePreferences?.avoidColors,
            likedBrands: userProfile.brandPreferences?.likedBrands,
            priceRange: userProfile.brandPreferences?.priceRange,
            modestDressing: userProfile.stylePreferences?.modestDressing,
            location: userProfile.location,
          },
        };
      }
    } catch (err) {
      // Profile not found is OK - user may not have completed onboarding
      this.logger.debug(`Profile not found for ${userId}, using defaults`);
    }
    return {};
  }

  /**
   * Parse filters from payload
   */
  private parseFilters(filters?: any): SearchFilters | undefined {
    if (!filters) return undefined;

    return {
      color: filters.color ? (Array.isArray(filters.color) ? filters.color : [filters.color]) : undefined,
      priceRange: filters.priceRange,
      style: filters.style,
      occasion: filters.occasion,
      itemType: filters.itemType || filters.category, // Map category to itemType
      brand: filters.brand ? (Array.isArray(filters.brand) ? filters.brand : [filters.brand]) : undefined,
      gender: filters.gender,
    };
  }

  @SubscribeMessage('chat:feedback')
  async handleFeedback(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: {
      userId: string;
      productUrl: string;
      feedback: 'like' | 'dislike';
      reason?: string;
    },
  ) {
    try {
      // Save feedback to database
      await this.feedbackModel.findOneAndUpdate(
        {
          userId: payload.userId,
          productUrl: payload.productUrl,
        },
        {
          $set: {
            feedback: payload.feedback,
            reason: payload.reason,
            updatedAt: new Date(),
          },
        },
        {
          upsert: true,
          new: true,
        },
      );

      this.logger.log(
        `Feedback saved: ${payload.feedback} for ${payload.productUrl}`,
      );

      client.emit('chat:feedback:received', { success: true });
    } catch (error) {
      this.logger.error('Feedback error:', error);
      client.emit('chat:error', { message: 'Failed to save feedback' });
    }
  }

  /**
   * Handle conversation reset
   */
  @SubscribeMessage('chat:reset')
  async handleReset(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { userId: string; sessionId: string },
  ) {
    const contextKey = `${payload.userId}:${payload.sessionId}`;
    this.conversationContexts.delete(contextKey);

    this.logger.log(`Conversation reset for ${contextKey}`);

    client.emit('chat:reset:complete', { success: true });
  }
}
