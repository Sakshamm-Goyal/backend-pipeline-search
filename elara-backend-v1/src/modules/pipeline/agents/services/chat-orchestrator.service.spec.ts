import { Test, TestingModule } from '@nestjs/testing';
import { ChatOrchestratorService } from './chat-orchestrator.service';
import { IntentRouterService, AgentType, RoutingDecision } from './intent-router.service';
import { SearchAgentService } from './search-agent.service';
import { OutfitGeneratorAgentService } from './outfit-generator-agent.service';
import type { ConversationContext, AgentResponse } from '../dto/chat-message.dto';
import { ResponseType } from '../dto/chat-message.dto';

describe('ChatOrchestratorService', () => {
  let service: ChatOrchestratorService;
  let intentRouter: jest.Mocked<IntentRouterService>;
  let searchAgent: jest.Mocked<SearchAgentService>;
  let outfitGenerator: jest.Mocked<OutfitGeneratorAgentService>;

  // Factory function to create fresh context for each test (avoid mutation issues)
  const createMockContext = (): ConversationContext => ({
    conversationId: 'test-conversation-id',
    userId: 'test-user-id',
    sessionId: 'test-session-id',
    history: [],
    metadata: {
      startedAt: new Date(),
      lastMessageAt: new Date(),
      messageCount: 0,
    },
  });

  const mockRoutingDecision: RoutingDecision = {
    agent: AgentType.SEARCH,
    intent: 'product_search',
    confidence: 0.9,
    filters: { gender: 'female', category: 'dress' },
    needsClarification: false,
    reasoning: 'User is looking for dresses',
    processingTime: 100,
  };

  const mockAgentResponse: AgentResponse = {
    message: 'I found 42 dresses for you!',
    type: ResponseType.PRODUCT_LIST,
    data: {
      products: [],
      totalFound: 42,
    },
    metadata: {
      intent: 'product_search',
      confidence: 0.9,
      agentUsed: 'search',
      processingTime: 2000,
    },
    suggestedActions: [],
  };

  beforeEach(async () => {
    const mockIntentRouterService = {
      route: jest.fn(),
      generateClarification: jest.fn().mockResolvedValue('Could you tell me more about what you are looking for?'),
    };

    const mockSearchAgentService = {
      execute: jest.fn(),
    };

    const mockOutfitGeneratorService = {
      execute: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatOrchestratorService,
        {
          provide: IntentRouterService,
          useValue: mockIntentRouterService,
        },
        {
          provide: SearchAgentService,
          useValue: mockSearchAgentService,
        },
        {
          provide: OutfitGeneratorAgentService,
          useValue: mockOutfitGeneratorService,
        },
      ],
    }).compile();

    service = module.get<ChatOrchestratorService>(ChatOrchestratorService);
    intentRouter = module.get(IntentRouterService) as jest.Mocked<IntentRouterService>;
    searchAgent = module.get(SearchAgentService) as jest.Mocked<SearchAgentService>;
    outfitGenerator = module.get(OutfitGeneratorAgentService) as jest.Mocked<OutfitGeneratorAgentService>;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createNewContext', () => {
    it('should create a new conversation context', () => {
      const context = service.createNewContext('user-123', 'session-456');

      expect(context).toMatchObject({
        userId: 'user-123',
        sessionId: 'session-456',
        history: [],
      });
      expect(context.conversationId).toBeDefined();
      expect(context.metadata?.startedAt).toBeInstanceOf(Date);
      expect(context.metadata?.messageCount).toBe(0);
    });

    it('should generate unique conversation IDs', () => {
      const context1 = service.createNewContext('user-1');
      const context2 = service.createNewContext('user-1');

      expect(context1.conversationId).not.toBe(context2.conversationId);
    });

    it('should generate a sessionId if not provided', () => {
      const context = service.createNewContext('user-123');

      // When sessionId not provided, a new UUID is generated
      expect(context.sessionId).toBeDefined();
      expect(context.sessionId!.length).toBeGreaterThan(0);
    });
  });

  describe('processMessage', () => {
    beforeEach(() => {
      intentRouter.route.mockResolvedValue(mockRoutingDecision);
      searchAgent.execute.mockResolvedValue(mockAgentResponse);
    });

    it('should process a message and return agent response', async () => {
      const result = await service.processMessage(
        'Show me red dresses',
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.response).toEqual(mockAgentResponse);
      expect(result.conversationContext).toBeDefined();
    });

    it('should route message through intent router', async () => {
      const context = createMockContext();

      await service.processMessage(
        'Show me red dresses',
        context,
      );

      expect(intentRouter.route).toHaveBeenCalledWith(
        'Show me red dresses',
        context,
        undefined,
      );
    });

    it('should execute search agent for product_search intent', async () => {
      await service.processMessage(
        'Show me red dresses',
        createMockContext(),
      );

      expect(searchAgent.execute).toHaveBeenCalledWith(
        'Show me red dresses',
        mockRoutingDecision,
        undefined,
      );
    });

    it('should execute outfit generator for outfit_generation intent', async () => {
      const outfitRouting: RoutingDecision = {
        ...mockRoutingDecision,
        agent: AgentType.OUTFIT_GENERATOR,
        intent: 'outfit_generation',
        reasoning: 'User wants a professional outfit',
      };

      intentRouter.route.mockResolvedValue(outfitRouting);
      outfitGenerator.execute.mockResolvedValue(mockAgentResponse);

      await service.processMessage(
        'Create a professional outfit',
        createMockContext(),
      );

      expect(outfitGenerator.execute).toHaveBeenCalledWith(
        'Create a professional outfit',
        outfitRouting,
        undefined,
      );
    });

    it('should update conversation history with user and assistant messages', async () => {
      const result = await service.processMessage(
        'Show me dresses',
        createMockContext(),
      );

      expect(result.conversationContext.history).toHaveLength(2);
      expect(result.conversationContext.history[0]).toMatchObject({
        role: 'user',
        content: 'Show me dresses',
      });
      expect(result.conversationContext.history[1]).toMatchObject({
        role: 'assistant',
        content: mockAgentResponse.message,
      });
    });

    it('should update conversation metadata', async () => {
      const context = createMockContext();
      const originalStartedAt = context.metadata?.startedAt;

      const result = await service.processMessage(
        'Show me dresses',
        context,
      );

      expect(result.conversationContext.metadata?.messageCount).toBe(2);
      expect(result.conversationContext.metadata?.lastMessageAt).toBeInstanceOf(Date);
      expect(result.conversationContext.metadata?.startedAt).toEqual(originalStartedAt);
    });

    it('should maintain conversation history across multiple messages', async () => {
      // Create a fresh context for this test
      let context: ConversationContext = {
        ...createMockContext(),
        history: [],
        metadata: {
          startedAt: new Date(),
          lastMessageAt: new Date(),
          messageCount: 0,
        },
      };

      // First message
      const result1 = await service.processMessage('Show me dresses', context);
      context = result1.conversationContext;

      // Second message
      const result2 = await service.processMessage('Show me in red', context);

      expect(result2.conversationContext.history.length).toBe(4);
      expect(result2.conversationContext.metadata?.messageCount).toBe(4);
    });

    it('should limit conversation history to 20 messages', async () => {
      const baseContext = createMockContext();
      const context: ConversationContext = {
        ...baseContext,
        history: Array.from({ length: 18 }, (_, i) => ({
          id: `msg-${i}`,
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i}`,
          timestamp: new Date(),
        })),
        metadata: {
          startedAt: baseContext.metadata?.startedAt ?? new Date(),
          lastMessageAt: baseContext.metadata?.lastMessageAt ?? new Date(),
          messageCount: 18,
        },
      };

      const result = await service.processMessage('New message', context);

      expect(result.conversationContext.history.length).toBe(20);
      expect(result.conversationContext.history[0].content).toBe('Message 0');
    });

    it('should handle clarification requests', async () => {
      const clarificationRouting: RoutingDecision = {
        ...mockRoutingDecision,
        needsClarification: true,
        clarificationFields: ['category', 'occasion'],
      };

      intentRouter.route.mockResolvedValue(clarificationRouting);

      const result = await service.processMessage(
        'I need something',
        createMockContext(),
      );

      expect(result.success).toBe(true);
      expect(result.response.type).toBe(ResponseType.CLARIFICATION);
      expect(result.conversationContext.awaitingClarification).toBe(true);
    });

    it('should pass user context to router and agent', async () => {
      const context = createMockContext();
      const userContext = {
        gender: 'female',
        style: 'casual',
      };

      await service.processMessage(
        'Show me dresses',
        context,
        userContext,
      );

      expect(intentRouter.route).toHaveBeenCalledWith(
        'Show me dresses',
        context,
        userContext,
      );

      expect(searchAgent.execute).toHaveBeenCalledWith(
        'Show me dresses',
        mockRoutingDecision,
        userContext,
      );
    });

    it('should store current intent in context', async () => {
      const result = await service.processMessage(
        'Show me dresses',
        createMockContext(),
      );

      expect(result.conversationContext.currentIntent).toBe('product_search');
    });

    it('should handle agent execution errors gracefully', async () => {
      searchAgent.execute.mockRejectedValue(new Error('Search failed'));

      const result = await service.processMessage(
        'Show me dresses',
        createMockContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Search failed');
      expect(result.response.type).toBe(ResponseType.ERROR);
    });

    it('should handle intent router errors gracefully', async () => {
      intentRouter.route.mockRejectedValue(new Error('Routing failed'));

      const result = await service.processMessage(
        'Show me dresses',
        createMockContext(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Routing failed');
    });

    it('should generate unique message IDs', async () => {
      const result = await service.processMessage(
        'Show me dresses',
        createMockContext(),
      );

      const messageIds = result.conversationContext.history.map((m) => m.id);
      const uniqueIds = new Set(messageIds);

      expect(uniqueIds.size).toBe(messageIds.length);
    });

    it('should include timestamp in messages', async () => {
      const result = await service.processMessage(
        'Show me dresses',
        createMockContext(),
      );

      // Check that timestamps are valid dates
      result.conversationContext.history.forEach((msg) => {
        expect(msg.timestamp).toBeInstanceOf(Date);
        expect(msg.timestamp.getTime()).toBeGreaterThan(0);
      });
    });

    it('should handle greeting intent with chat handler', async () => {
      const greetingRouting: RoutingDecision = {
        ...mockRoutingDecision,
        agent: AgentType.CHAT,
        intent: 'greeting',
      };

      const greetingResponse: AgentResponse = {
        message: 'Hello! How can I help you find the perfect outfit today?',
        type: ResponseType.TEXT,
        suggestedActions: [],
      };

      intentRouter.route.mockResolvedValue(greetingRouting);

      const result = await service.processMessage('Hello', createMockContext());

      expect(result.success).toBe(true);
      expect(result.response.type).toBe(ResponseType.TEXT);
    });

    it('should handle feedback intent', async () => {
      const feedbackRouting: RoutingDecision = {
        ...mockRoutingDecision,
        agent: AgentType.FEEDBACK,
        intent: 'feedback',
      };

      intentRouter.route.mockResolvedValue(feedbackRouting);

      const result = await service.processMessage(
        'I love this!',
        createMockContext(),
      );

      expect(result.success).toBe(true);
    });
  });
});
