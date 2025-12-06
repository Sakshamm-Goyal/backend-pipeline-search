import { Test, TestingModule } from '@nestjs/testing';
import { IntentRouterService } from './intent-router.service';
import { ClaudeService } from '../../infrastructure/llm/claude.service';
import type { ConversationContext } from '../dto/chat-message.dto';

describe('IntentRouterService', () => {
  let service: IntentRouterService;
  let claudeService: jest.Mocked<ClaudeService>;

  const mockConversationContext: ConversationContext = {
    conversationId: 'test-conversation-id',
    userId: 'test-user-id',
    sessionId: 'test-session-id',
    history: [],
    metadata: {
      startedAt: new Date(),
      lastMessageAt: new Date(),
      messageCount: 0,
    },
  };

  beforeEach(async () => {
    const mockClaudeService = {
      classifyIntent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntentRouterService,
        {
          provide: ClaudeService,
          useValue: mockClaudeService,
        },
      ],
    }).compile();

    service = module.get<IntentRouterService>(IntentRouterService);
    claudeService = module.get(ClaudeService) as jest.Mocked<ClaudeService>;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('route', () => {
    it('should route to search agent for product search intent with high confidence', async () => {
      const message = 'I need a red dress';
      claudeService.classifyIntent.mockResolvedValue({
        intent: 'product_search',
        confidence: 0.95,
        filters: {
          gender: 'female',
          color: 'red',
          category: 'dress',
        },
        reasoning: 'User is looking for a red dress',
      });

      const result = await service.route(message, mockConversationContext);

      expect(result.agent).toBe('search');
      expect(result.intent).toBe('product_search');
      expect(result.confidence).toBe(0.95);
      expect(result.needsClarification).toBe(false);
      expect(result.filters).toEqual({
        gender: 'female',
        color: 'red',
        category: 'dress',
      });
    });

    it('should route to outfit generator for outfit request intent', async () => {
      const message = 'Create an outfit for a job interview';
      claudeService.classifyIntent.mockResolvedValue({
        intent: 'outfit_request',
        confidence: 0.88,
        filters: {
          occasion: 'professional',
        },
        reasoning: 'User wants complete outfit',
      });

      const result = await service.route(message, mockConversationContext);

      expect(result.agent).toBe('outfit_generator');
      expect(result.intent).toBe('outfit_request');
      expect(result.needsClarification).toBe(false);
    });

    it('should request clarification for low confidence intent', async () => {
      const message = 'Something nice';
      claudeService.classifyIntent.mockResolvedValue({
        intent: 'product_search',
        confidence: 0.45,
        filters: {},
        clarificationNeeded: ['category', 'occasion', 'style'],
        reasoning: 'Need more info',
      });

      const result = await service.route(message, mockConversationContext);

      expect(result.needsClarification).toBe(true);
      expect(result.clarificationFields).toContain('category');
      expect(result.clarificationFields).toContain('occasion');
    });

    it('should request clarification when intent is clarification_needed', async () => {
      const message = 'I want clothes';
      claudeService.classifyIntent.mockResolvedValue({
        intent: 'clarification_needed',
        confidence: 0.6,
        filters: {},
        reasoning: 'Vague request needs more details',
        clarificationNeeded: ['category', 'gender'],
      });

      const result = await service.route(message, mockConversationContext);

      expect(result.needsClarification).toBe(true);
      expect(result.intent).toBe('clarification_needed');
    });

    it('should route to chat handler for greeting intent', async () => {
      const message = 'Hello';
      claudeService.classifyIntent.mockResolvedValue({
        intent: 'greeting',
        confidence: 0.99,
        filters: {},
        reasoning: 'User is greeting',
      });

      const result = await service.route(message, mockConversationContext);

      expect(result.agent).toBe('chat');
      expect(result.intent).toBe('greeting');
      expect(result.needsClarification).toBe(false);
    });

    it('should route to feedback handler for feedback intent', async () => {
      const message = 'I love this dress!';
      claudeService.classifyIntent.mockResolvedValue({
        intent: 'feedback',
        confidence: 0.92,
        filters: {},
        reasoning: 'User is giving positive feedback',
      });

      const result = await service.route(message, mockConversationContext);

      expect(result.agent).toBe('feedback');
      expect(result.intent).toBe('feedback');
    });

    it('should pass conversation history to Claude service', async () => {
      const contextWithHistory: ConversationContext = {
        ...mockConversationContext,
        history: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Show me dresses',
            timestamp: new Date(),
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'Here are some dresses',
            timestamp: new Date(),
          },
        ],
      };

      claudeService.classifyIntent.mockResolvedValue({
        intent: 'product_search',
        confidence: 0.9,
        filters: { color: 'blue' },
        reasoning: 'User wants blue items',
      });

      await service.route('Show me in blue', contextWithHistory);

      expect(claudeService.classifyIntent).toHaveBeenCalledWith(
        'Show me in blue',
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Show me dresses' }),
          expect.objectContaining({ role: 'assistant', content: 'Here are some dresses' }),
        ]),
        undefined,
      );
    });

    it('should pass user context to Claude service', async () => {
      const userContext = {
        gender: 'female',
        style: 'casual',
        sizes: { top: 'M', bottom: '8' },
      };

      claudeService.classifyIntent.mockResolvedValue({
        intent: 'product_search',
        confidence: 0.85,
        filters: {},
        reasoning: 'User searching for products',
      });

      await service.route('Find something for me', mockConversationContext, userContext);

      expect(claudeService.classifyIntent).toHaveBeenCalledWith(
        'Find something for me',
        expect.any(Array),
        userContext,
      );
    });

    it('should include processing time in routing decision', async () => {
      claudeService.classifyIntent.mockResolvedValue({
        intent: 'product_search',
        confidence: 0.9,
        filters: {},
        reasoning: 'Product search',
      });

      const result = await service.route('Show me shoes', mockConversationContext);

      expect(result.processingTime).toBeGreaterThanOrEqual(0);
      expect(typeof result.processingTime).toBe('number');
    });

    it('should handle Claude service errors gracefully', async () => {
      claudeService.classifyIntent.mockRejectedValue(
        new Error('Claude API error'),
      );

      const result = await service.route('Show me dresses', mockConversationContext);

      // Should fallback to chat agent instead of throwing
      expect(result.agent).toBe('chat');
      expect(result.intent).toBe('general_chat');
      expect(result.confidence).toBe(0.5);
    });

    it('should limit conversation history to last 5 messages', async () => {
      const contextWithManyMessages: ConversationContext = {
        ...mockConversationContext,
        history: Array.from({ length: 10 }, (_, i) => ({
          id: `msg-${i}`,
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i}`,
          timestamp: new Date(),
        })),
      };

      claudeService.classifyIntent.mockResolvedValue({
        intent: 'product_search',
        confidence: 0.9,
        filters: {},
        reasoning: 'User wants more products',
      });

      await service.route('Show me more', contextWithManyMessages);

      const historyArg = claudeService.classifyIntent.mock.calls[0][1];
      expect(historyArg).toHaveLength(5);
      expect(historyArg[0].content).toBe('Message 5');
    });
  });
});
