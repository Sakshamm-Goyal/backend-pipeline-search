import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  Logger,
  BadRequestException,
  NotFoundException,
  UseGuards,
  Optional,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ChatOrchestratorService } from '../services/chat-orchestrator.service';
import {
  SendMessageDto,
  ChatResponseDto,
  CreateConversationDto,
  ConversationResponseDto,
  ConversationHistoryDto,
  ListConversationsQueryDto,
  HealthCheckDto,
} from '../dto/chat-api.dto';
import { ConversationContext } from '../dto/chat-message.dto';
import { CurrentUser } from '../../../auth/application/decorators/current-user.decorator';
import { Public } from '../../../auth/application/decorators/public.decorator';
import { ConversationRepository } from '../infrastructure/persistence/conversation.repository';
import { UserProfileRepository } from '../../../onboarding/infrastructure/repositories/user-profile.repository';

/**
 * Chat Controller
 *
 * Handles all chat-related API endpoints:
 * - Send messages
 * - Create conversations
 * - Get conversation history
 * - Health checks
 *
 * Base path: /api/v1/chat
 *
 * Authentication: All endpoints require JWT authentication except health check
 */
@ApiTags('Chat')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private chatOrchestrator: ChatOrchestratorService,
    private conversationRepository: ConversationRepository,
    @Optional() private userProfileRepository?: UserProfileRepository,
  ) {}

  /**
   * Send a message to the chat system
   *
   * POST /api/chat/message
   */
  @Post('message')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a chat message',
    description: 'Process a user message and get AI response. Can start a new conversation or continue an existing one.',
  })
  @ApiResponse({
    status: 200,
    description: 'Message processed successfully',
    type: ChatResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid request payload',
  })
  async sendMessage(
    @Body(ValidationPipe) dto: SendMessageDto,
    @CurrentUser('_id') userId: string,
  ): Promise<ChatResponseDto> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Processing message for user ${userId}, conversation ${dto.conversationId || 'new'}: "${dto.message}"`,
      );

      // Get or create conversation context
      let context: ConversationContext;

      if (dto.conversationId) {
        // Load existing conversation from database
        const existingConversation = await this.conversationRepository.findById(
          dto.conversationId,
          userId,
        );

        if (existingConversation) {
          context = existingConversation;
          this.logger.debug(`Loaded existing conversation ${dto.conversationId}`);
        } else {
          // Conversation not found, create new one with provided ID
          this.logger.warn(
            `Conversation ${dto.conversationId} not found, creating new conversation`,
          );
          context = this.chatOrchestrator.createNewContext(
            userId,
            dto.sessionId,
          );
        }
      } else {
        // Create new conversation
        context = this.chatOrchestrator.createNewContext(
          userId,
          dto.sessionId,
        );
      }

      // CRITICAL: Fetch user profile from database and merge with userContext
      // This ensures gender, size, style preferences are used in search
      const userContext = await this.buildUserContext(userId, dto.userContext);

      // Process the message
      const result = await this.chatOrchestrator.processMessage(
        dto.message,
        context,
        userContext,
      );

      // Save conversation to database
      await this.conversationRepository.save(result.conversationContext);
      this.logger.debug(`Saved conversation ${result.conversationContext.conversationId} to database`);

      const duration = Date.now() - startTime;
      this.logger.log(
        `Message processed in ${duration}ms (conversation: ${result.conversationContext.conversationId})`,
      );

      return result as ChatResponseDto;
    } catch (error) {
      this.logger.error(
        `Failed to process message: ${(error as Error).message}`,
        (error as Error).stack,
      );

      throw new BadRequestException(
        `Failed to process message: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Create a new conversation
   *
   * POST /api/chat/conversations
   */
  @Post('conversations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new conversation',
    description: 'Initialize a new conversation context for a user',
  })
  @ApiResponse({
    status: 201,
    description: 'Conversation created successfully',
    type: ConversationResponseDto,
  })
  async createConversation(
    @Body(ValidationPipe) dto: CreateConversationDto,
    @CurrentUser('_id') userId: string,
  ): Promise<ConversationResponseDto> {
    this.logger.log(`Creating new conversation for user ${userId}`);

    const conversation = this.chatOrchestrator.createNewContext(
      userId,
      dto.sessionId,
    );

    // Save conversation to database
    await this.conversationRepository.save(conversation);
    this.logger.debug(`Saved new conversation ${conversation.conversationId} to database`);

    return { conversation };
  }

  /**
   * Get conversation by ID
   *
   * GET /api/chat/conversations/:id
   */
  @Get('conversations/:id')
  @ApiOperation({
    summary: 'Get conversation by ID',
    description: 'Retrieve conversation history and metadata',
  })
  @ApiResponse({
    status: 200,
    description: 'Conversation found',
    type: ConversationHistoryDto,
  })
  @ApiNotFoundResponse({
    description: 'Conversation not found',
  })
  async getConversation(
    @Param('id') conversationId: string,
    @CurrentUser('_id') userId: string,
  ): Promise<ConversationHistoryDto> {
    this.logger.log(`Fetching conversation ${conversationId} for user ${userId}`);

    // Load conversation from database (automatically verifies ownership)
    const conversation = await this.conversationRepository.findById(conversationId, userId);

    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    return {
      conversationId: conversation.conversationId || conversationId,
      messageCount: conversation.metadata?.messageCount || conversation.history.length,
      messages: conversation.history,
      metadata: conversation.metadata,
    };
  }

  /**
   * List conversations for a user
   *
   * GET /api/chat/conversations?userId=xxx
   */
  @Get('conversations')
  @ApiOperation({
    summary: 'List user conversations',
    description: 'Get all conversations for the authenticated user with pagination',
  })
  @ApiResponse({
    status: 200,
    description: 'Conversations retrieved successfully',
    type: [ConversationHistoryDto],
  })
  async listConversations(
    @CurrentUser('_id') userId: string,
    @Query() query: ListConversationsQueryDto,
  ): Promise<{ conversations: ConversationHistoryDto[]; pagination: { total: number; page: number; totalPages: number } }> {
    this.logger.log(`Listing conversations for user ${userId} (page ${query.page || 1})`);

    // Load conversations from database with pagination
    const result = await this.conversationRepository.findByUserId(
      userId,
      query.page || 1,
      query.limit || 10,
    );

    return {
      conversations: result.conversations.map((conversation, index) => ({
        conversationId: conversation.conversationId || `conv_${index}`,
        messageCount: conversation.metadata?.messageCount || conversation.history.length,
        messages: conversation.history,
        metadata: conversation.metadata,
      })),
      pagination: {
        total: result.total,
        page: result.page,
        totalPages: result.totalPages,
      },
    };
  }

  /**
   * Delete conversation
   *
   * DELETE /api/chat/conversations/:id
   */
  @Post('conversations/:id/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a conversation',
    description: 'Permanently delete a conversation and its history',
  })
  @ApiResponse({
    status: 200,
    description: 'Conversation deleted successfully',
  })
  @ApiNotFoundResponse({
    description: 'Conversation not found',
  })
  async deleteConversation(
    @Param('id') conversationId: string,
    @CurrentUser('_id') userId: string,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Deleting conversation ${conversationId} for user ${userId}`);

    // Delete conversation from database (automatically verifies ownership)
    const deleted = await this.conversationRepository.delete(conversationId, userId);

    if (!deleted) {
      throw new NotFoundException(
        `Conversation ${conversationId} not found or already deleted`,
      );
    }

    return {
      success: true,
      message: 'Conversation deleted successfully',
    };
  }

  /**
   * Health check endpoint
   *
   * GET /api/chat/health
   */
  @Public()
  @Get('health')
  @ApiOperation({
    summary: 'Health check',
    description: 'Check if chat services are operational',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is healthy',
    type: HealthCheckDto,
  })
  async healthCheck(): Promise<HealthCheckDto> {
    // Perform basic health checks
    const health: HealthCheckDto = {
      status: 'healthy',
      timestamp: new Date(),
      components: {
        chatOrchestrator: true,
        intentRouter: true,
        searchAgent: true,
        outfitGenerator: true,
      },
    };

    // Check if services are accessible
    try {
      // Test conversation creation
      this.chatOrchestrator.createNewContext('health-check-user');
    } catch (error) {
      health.status = 'unhealthy';
      health.components.chatOrchestrator = false;
      this.logger.error(
        `Health check failed: ${(error as Error).message}`,
      );
    }

    return health;
  }

  /**
   * Build user context by fetching profile from database and merging with request context
   * CRITICAL: This ensures user's gender, size, style preferences are used in search
   */
  private async buildUserContext(userId: string, requestContext?: any): Promise<any> {
    const userContext: any = {
      userId,
      ...requestContext,
      profile: requestContext?.profile || {},
    };

    // Fetch user profile from database
    if (this.userProfileRepository) {
      try {
        const profile = await this.userProfileRepository.findByUserId(userId);

        if (profile) {
          this.logger.debug(`Loaded user profile for ${userId}: gender=${profile.gender}`);

          // Build profile object for search context
          userContext.profile = {
            // Basic info
            gender: profile.gender,
            bodyType: profile.fullBodyAnalysis?.final?.bodyType ||
                      profile.fullBodyAnalysis?.userOverrides?.bodyType ||
                      profile.fullBodyAnalysis?.aiExtracted?.bodyType,

            // Style preferences
            primaryStyle: profile.stylePreferences?.primaryStyle,
            selectedStyles: profile.stylePreferences?.selectedStyles || [],
            avoidStyles: profile.stylePreferences?.avoidStyles || [],
            colorPreferences: profile.stylePreferences?.colorPreferences || [],
            avoidColors: profile.stylePreferences?.avoidColors || [],

            // Brand & budget preferences
            likedBrands: profile.brandPreferences?.likedBrands || [],
            dislikedBrands: profile.brandPreferences?.dislikedBrands || [],
            priceRange: profile.brandPreferences?.priceRange,

            // Sizing (critical for plus-size searches!)
            sizing: profile.sizing,
            size: profile.sizing?.dresses || profile.sizing?.tops,

            // Fit preferences
            fitPreferences: profile.fitPreferences,

            // Location
            location: profile.location,

            // Override with request context if provided
            ...requestContext?.profile,
          };
        }
      } catch (error) {
        this.logger.warn(`Failed to load user profile: ${(error as Error).message}`);
      }
    }

    return userContext;
  }
}
