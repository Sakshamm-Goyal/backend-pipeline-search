import { IsString, IsNotEmpty, IsOptional, IsUUID, ValidateNested, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { AgentResponse, ConversationContext } from './chat-message.dto';

/**
 * Request DTO for sending a chat message
 */
export class SendMessageDto {
  @ApiProperty({
    description: 'The user message to process',
    example: 'I need a dress for a wedding',
  })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({
    description: 'Conversation ID to continue an existing conversation',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiPropertyOptional({
    description: 'Session ID for tracking user sessions',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({
    description: 'User context (preferences, wardrobe, etc.)',
    example: {
      gender: 'female',
      style: 'casual',
      sizes: { top: 'M', bottom: '8' },
    },
  })
  @IsOptional()
  @IsObject()
  userContext?: any;
}

/**
 * Response DTO for chat messages
 */
export class ChatResponseDto {
  @ApiProperty({
    description: 'Whether the message was processed successfully',
    example: true,
  })
  success!: boolean;

  @ApiProperty({
    description: 'The agent response',
  })
  response!: AgentResponse;

  @ApiProperty({
    description: 'Updated conversation context',
  })
  conversationContext!: ConversationContext;

  @ApiPropertyOptional({
    description: 'Error message if processing failed',
    example: 'Failed to process message',
  })
  error?: string;
}

/**
 * Request DTO for creating a new conversation
 */
export class CreateConversationDto {
  @ApiProperty({
    description: 'User ID',
    example: 'user_123',
  })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiPropertyOptional({
    description: 'Session ID',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({
    description: 'Initial user context',
  })
  @IsOptional()
  @IsObject()
  userContext?: any;
}

/**
 * Response DTO for conversation operations
 */
export class ConversationResponseDto {
  @ApiProperty({
    description: 'The conversation context',
  })
  conversation!: ConversationContext;
}

/**
 * Response DTO for getting conversation history
 */
export class ConversationHistoryDto {
  @ApiProperty({
    description: 'Conversation ID',
  })
  conversationId!: string;

  @ApiProperty({
    description: 'Number of messages in conversation',
  })
  messageCount!: number;

  @ApiProperty({
    description: 'Conversation messages',
  })
  messages!: any[];

  @ApiProperty({
    description: 'Conversation metadata',
  })
  metadata!: any;
}

/**
 * Query parameters for listing conversations
 */
export class ListConversationsQueryDto {
  @ApiPropertyOptional({
    description: 'Page number',
    example: 1,
    default: 1,
  })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({
    description: 'Number of conversations per page',
    example: 20,
    default: 20,
  })
  @IsOptional()
  limit?: number;
}

/**
 * Health check response
 */
export class HealthCheckDto {
  @ApiProperty({
    description: 'Service health status',
    example: 'healthy',
  })
  status!: string;

  @ApiProperty({
    description: 'Timestamp of health check',
  })
  timestamp!: Date;

  @ApiProperty({
    description: 'Service components health',
  })
  components!: {
    chatOrchestrator: boolean;
    intentRouter: boolean;
    searchAgent: boolean;
    outfitGenerator: boolean;
  };
}
