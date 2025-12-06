import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatOrchestratorService } from '../services/chat-orchestrator.service';
import { ConversationRepository } from '../infrastructure/persistence/conversation.repository';
import { SendMessageDto, CreateConversationDto } from '../dto/chat-api.dto';
import type { ConversationContext, AgentResponse } from '../dto/chat-message.dto';
import { ResponseType } from '../dto/chat-message.dto';

describe('ChatController', () => {
  let controller: ChatController;
  let chatOrchestrator: jest.Mocked<ChatOrchestratorService>;
  let conversationRepository: jest.Mocked<ConversationRepository>;

  const mockUserId = 'user-123';

  const mockConversationContext: ConversationContext = {
    conversationId: 'conversation-123',
    userId: mockUserId,
    sessionId: 'session-123',
    history: [],
    metadata: {
      startedAt: new Date(),
      lastMessageAt: new Date(),
      messageCount: 0,
    },
  };

  const mockAgentResponse: AgentResponse = {
    message: 'I found 42 dresses for you!',
    type: ResponseType.PRODUCT_LIST,
    data: {
      products: [],
      totalFound: 42,
    },
    suggestedActions: [],
  };

  beforeEach(async () => {
    const mockChatOrchestratorService = {
      createNewContext: jest.fn(),
      processMessage: jest.fn(),
    };

    const mockConversationRepository = {
      save: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      findByUserId: jest.fn().mockResolvedValue({ conversations: [], total: 0, page: 1, totalPages: 0 }),
      delete: jest.fn().mockResolvedValue(true),
      existsAndBelongsToUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        {
          provide: ChatOrchestratorService,
          useValue: mockChatOrchestratorService,
        },
        {
          provide: ConversationRepository,
          useValue: mockConversationRepository,
        },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
    chatOrchestrator = module.get(ChatOrchestratorService) as jest.Mocked<ChatOrchestratorService>;
    conversationRepository = module.get(ConversationRepository) as jest.Mocked<ConversationRepository>;
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('sendMessage', () => {
    const sendMessageDto: SendMessageDto = {
      message: 'Show me red dresses',
    };

    beforeEach(() => {
      chatOrchestrator.createNewContext.mockReturnValue(mockConversationContext);
      chatOrchestrator.processMessage.mockResolvedValue({
        success: true,
        response: mockAgentResponse,
        conversationContext: mockConversationContext,
      });
    });

    it('should send message and return chat response', async () => {
      const result = await controller.sendMessage(sendMessageDto, mockUserId);

      expect(result.success).toBe(true);
      expect(result.response).toEqual(mockAgentResponse);
      expect(result.conversationContext).toEqual(mockConversationContext);
    });

    it('should create new context if no conversationId provided', async () => {
      await controller.sendMessage(sendMessageDto, mockUserId);

      expect(chatOrchestrator.createNewContext).toHaveBeenCalledWith(
        mockUserId,
        undefined,
      );
    });

    it('should use authenticated userId for new conversations', async () => {
      await controller.sendMessage(sendMessageDto, mockUserId);

      expect(chatOrchestrator.createNewContext).toHaveBeenCalledWith(
        mockUserId,
        undefined,
      );
      expect(chatOrchestrator.createNewContext).not.toHaveBeenCalledWith(
        'anonymous',
        expect.any(String),
      );
    });

    it('should load existing context if conversationId provided', async () => {
      const dtoWithConversation: SendMessageDto = {
        ...sendMessageDto,
        conversationId: 'existing-conversation-id',
      };

      conversationRepository.findById.mockResolvedValue(mockConversationContext);

      await controller.sendMessage(dtoWithConversation, mockUserId);

      expect(conversationRepository.findById).toHaveBeenCalledWith(
        'existing-conversation-id',
        mockUserId,
      );
    });

    it('should pass sessionId if provided', async () => {
      const dtoWithSession: SendMessageDto = {
        ...sendMessageDto,
        sessionId: 'custom-session-id',
      };

      await controller.sendMessage(dtoWithSession, mockUserId);

      expect(chatOrchestrator.createNewContext).toHaveBeenCalledWith(
        mockUserId,
        'custom-session-id',
      );
    });

    it('should pass user context to chat orchestrator', async () => {
      const dtoWithContext: SendMessageDto = {
        ...sendMessageDto,
        userContext: {
          gender: 'female',
          style: 'casual',
        },
      };

      await controller.sendMessage(dtoWithContext, mockUserId);

      expect(chatOrchestrator.processMessage).toHaveBeenCalledWith(
        'Show me red dresses',
        expect.any(Object),
        {
          gender: 'female',
          style: 'casual',
        },
      );
    });

    it('should handle processing errors', async () => {
      chatOrchestrator.processMessage.mockRejectedValue(
        new Error('Processing failed'),
      );

      await expect(
        controller.sendMessage(sendMessageDto, mockUserId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should include error message in exception', async () => {
      const errorMessage = 'LLM service unavailable';
      chatOrchestrator.processMessage.mockRejectedValue(
        new Error(errorMessage),
      );

      await expect(
        controller.sendMessage(sendMessageDto, mockUserId),
      ).rejects.toThrow(errorMessage);
    });

    it('should return response with correct structure', async () => {
      const result = await controller.sendMessage(sendMessageDto, mockUserId);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('conversationContext');
      expect(result.response).toHaveProperty('message');
      expect(result.response).toHaveProperty('type');
    });
  });

  describe('createConversation', () => {
    const createConversationDto: CreateConversationDto = {
      userId: mockUserId,
    };

    beforeEach(() => {
      chatOrchestrator.createNewContext.mockReturnValue(mockConversationContext);
    });

    it('should create new conversation', async () => {
      const result = await controller.createConversation(
        createConversationDto,
        mockUserId,
      );

      expect(result.conversation).toEqual(mockConversationContext);
    });

    it('should use authenticated userId instead of DTO userId', async () => {
      await controller.createConversation(createConversationDto, mockUserId);

      expect(chatOrchestrator.createNewContext).toHaveBeenCalledWith(
        mockUserId,
        undefined,
      );
    });

    it('should pass sessionId if provided', async () => {
      const dtoWithSession: CreateConversationDto = {
        ...createConversationDto,
        sessionId: 'custom-session',
      };

      await controller.createConversation(dtoWithSession, mockUserId);

      expect(chatOrchestrator.createNewContext).toHaveBeenCalledWith(
        mockUserId,
        'custom-session',
      );
    });

    it('should return conversation with expected structure', async () => {
      const result = await controller.createConversation(
        createConversationDto,
        mockUserId,
      );

      expect(result.conversation).toHaveProperty('conversationId');
      expect(result.conversation).toHaveProperty('userId');
      expect(result.conversation).toHaveProperty('sessionId');
      expect(result.conversation).toHaveProperty('history');
      expect(result.conversation).toHaveProperty('metadata');
    });
  });

  describe('getConversation', () => {
    it('should throw NotFoundException for non-existent conversation', async () => {
      conversationRepository.findById.mockResolvedValue(null);

      await expect(
        controller.getConversation('conversation-id', mockUserId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return conversation history when found', async () => {
      conversationRepository.findById.mockResolvedValue(mockConversationContext);

      const result = await controller.getConversation('conversation-id', mockUserId);

      expect(result.conversationId).toBe(mockConversationContext.conversationId);
      expect(result.messages).toEqual(mockConversationContext.history);
    });
  });

  describe('listConversations', () => {
    it('should return conversations from repository', async () => {
      const result = await controller.listConversations(mockUserId, {});

      expect(result.conversations).toEqual([]);
      expect(result.pagination).toBeDefined();
    });

    it('should use authenticated userId', async () => {
      await controller.listConversations(mockUserId, {});

      expect(conversationRepository.findByUserId).toHaveBeenCalledWith(
        mockUserId,
        1,
        10,
      );
    });

    it('should accept pagination query params', async () => {
      const query = { page: 2, limit: 10 };
      await controller.listConversations(mockUserId, query);

      expect(conversationRepository.findByUserId).toHaveBeenCalledWith(
        mockUserId,
        2,
        10,
      );
    });
  });

  describe('deleteConversation', () => {
    it('should return success message when deleted', async () => {
      conversationRepository.delete.mockResolvedValue(true);

      const result = await controller.deleteConversation(
        'conversation-id',
        mockUserId,
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain('deleted successfully');
    });

    it('should call repository with userId for authorization', async () => {
      conversationRepository.delete.mockResolvedValue(true);

      await controller.deleteConversation('conversation-id', mockUserId);

      expect(conversationRepository.delete).toHaveBeenCalledWith(
        'conversation-id',
        mockUserId,
      );
    });

    it('should throw NotFoundException if conversation not found', async () => {
      conversationRepository.delete.mockResolvedValue(false);

      await expect(
        controller.deleteConversation('conversation-id', mockUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status', async () => {
      const result = await controller.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.components).toBeDefined();
    });

    it('should check all components', async () => {
      const result = await controller.healthCheck();

      expect(result.components).toHaveProperty('chatOrchestrator');
      expect(result.components).toHaveProperty('intentRouter');
      expect(result.components).toHaveProperty('searchAgent');
      expect(result.components).toHaveProperty('outfitGenerator');
    });

    it('should mark as healthy if orchestrator can create context', async () => {
      chatOrchestrator.createNewContext.mockReturnValue(mockConversationContext);

      const result = await controller.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.components.chatOrchestrator).toBe(true);
    });

    it('should mark as unhealthy if orchestrator fails', async () => {
      chatOrchestrator.createNewContext.mockImplementation(() => {
        throw new Error('Service unavailable');
      });

      const result = await controller.healthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.components.chatOrchestrator).toBe(false);
    });

    it('should not require authentication', async () => {
      // This endpoint should be marked with @Public() decorator
      const result = await controller.healthCheck();

      expect(result).toBeDefined();
    });
  });
});
