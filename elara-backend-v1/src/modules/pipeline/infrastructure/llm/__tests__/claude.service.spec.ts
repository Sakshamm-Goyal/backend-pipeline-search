import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClaudeService } from '../claude.service';
import Anthropic from '@anthropic-ai/sdk';

// Mock the Anthropic SDK
jest.mock('@anthropic-ai/sdk');

describe('ClaudeService', () => {
  let service: ClaudeService;
  let mockMessagesCreate: jest.Mock;
  let configService: ConfigService;

  const mockApiKey = 'test-api-key-12345';

  beforeEach(async () => {
    // Setup mock ConfigService
    const mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'ANTHROPIC_API_KEY') return mockApiKey;
        return null;
      }),
    };

    // Setup mock Anthropic client with proper jest mock
    mockMessagesCreate = jest.fn();
    const mockClient = {
      messages: {
        create: mockMessagesCreate,
      },
    };

    (Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementation(
      () => mockClient as any,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaudeService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<ClaudeService>(ClaudeService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should throw error if ANTHROPIC_API_KEY is missing', async () => {
      const mockConfigServiceNoKey = {
        get: jest.fn(() => null),
      };

      await expect(
        Test.createTestingModule({
          providers: [
            ClaudeService,
            {
              provide: ConfigService,
              useValue: mockConfigServiceNoKey,
            },
          ],
        }).compile(),
      ).rejects.toThrow('ANTHROPIC_API_KEY is required in environment variables');
    });

    it('should initialize with correct API key', () => {
      expect(Anthropic).toHaveBeenCalledWith({
        apiKey: mockApiKey,
      });
    });
  });

  describe('classifyIntent', () => {
    const mockUserContext = {
      profile: {
        gender: 'female',
        primaryStyle: 'minimal',
        selectedStyles: ['casual', 'modern'],
        priceRange: { min: 50, max: 200 },
        location: { city: 'New York' },
      },
    };

    it('should successfully classify product_search intent', async () => {
      const mockResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'product_search',
              confidence: 0.95,
              filters: {
                itemType: 'jeans',
                color: ['blue'],
                occasion: null,
                brand: null,
                priceRange: null,
                style: null,
              },
              reasoning: 'User is searching for a specific product type with color',
            }),
          },
        ],
      };

      mockMessagesCreate.mockResolvedValueOnce(mockResponse as any);

      const result = await service.classifyIntent(
        'I need blue jeans',
        [],
        mockUserContext,
      );

      expect(result).toEqual({
        intent: 'product_search',
        confidence: 0.95,
        filters: {
          itemType: 'jeans',
          color: ['blue'],
          occasion: null,
          brand: null,
          priceRange: null,
          style: null,
        },
        reasoning: 'User is searching for a specific product type with color',
        clarificationNeeded: undefined,
      });

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
        }),
      );
    });

    it('should handle outfit_request intent with occasion', async () => {
      const mockResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'outfit_request',
              confidence: 0.92,
              filters: {
                occasion: 'date',
                itemType: null,
                color: [],
                brand: [],
                priceRange: null,
                style: 'romantic',
              },
              reasoning: 'User wants a complete outfit for a specific occasion',
            }),
          },
        ],
      };

      mockMessagesCreate.mockResolvedValueOnce(mockResponse as any);

      const result = await service.classifyIntent(
        'What should I wear for a date night?',
        [],
        mockUserContext,
      );

      expect(result.intent).toBe('outfit_request');
      expect(result.filters.occasion).toBe('date');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('should handle general_chat intent', async () => {
      const mockResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'general_chat',
              confidence: 0.98,
              filters: {},
              reasoning: 'User is greeting the assistant',
            }),
          },
        ],
      };

      mockMessagesCreate.mockResolvedValueOnce(mockResponse as any);

      const result = await service.classifyIntent(
        'Hello! How are you?',
        [],
        mockUserContext,
      );

      expect(result.intent).toBe('general_chat');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('should handle clarification_needed intent', async () => {
      const mockResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'clarification_needed',
              confidence: 0.6,
              filters: {},
              reasoning: 'Message is too vague to classify confidently',
              clarificationNeeded: ['itemType', 'occasion'],
            }),
          },
        ],
      };

      mockMessagesCreate.mockResolvedValueOnce(mockResponse as any);

      const result = await service.classifyIntent(
        'I need something',
        [],
        mockUserContext,
      );

      expect(result.intent).toBe('clarification_needed');
      expect(result.confidence).toBeLessThan(0.7);
      expect(result.clarificationNeeded).toContain('itemType');
    });

    it('should parse response from markdown code block', async () => {
      const mockResponse = {
        content: [
          {
            text: '```json\n{"intent":"product_search","confidence":0.9,"filters":{},"reasoning":"test"}\n```',
          },
        ],
      };

      mockMessagesCreate.mockResolvedValueOnce(mockResponse as any);

      const result = await service.classifyIntent(
        'show me shoes',
        [],
        mockUserContext,
      );

      expect(result.intent).toBe('product_search');
      expect(result.confidence).toBe(0.9);
    });

    it('should include conversation history in request', async () => {
      const mockResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'product_search',
              confidence: 0.95,
              filters: {},
              reasoning: 'test',
            }),
          },
        ],
      };

      mockMessagesCreate.mockResolvedValueOnce(mockResponse as any);

      const conversationHistory = [
        { role: 'user' as const, content: 'Hi' },
        { role: 'assistant' as const, content: 'Hello!' },
        { role: 'user' as const, content: 'I need help' },
      ];

      await service.classifyIntent(
        'show me dresses',
        conversationHistory,
        mockUserContext,
      );

      const callArgs = mockMessagesCreate.mock.calls[0][0];
      expect(callArgs.messages.length).toBe(4); // 3 history + 1 new message
    });

    it('should handle API errors gracefully', async () => {
      mockMessagesCreate.mockRejectedValueOnce(
        new Error('API rate limit exceeded'),
      );

      await expect(
        service.classifyIntent('test message', [], mockUserContext),
      ).rejects.toThrow('API rate limit exceeded');
    });

    it('should fallback to general_chat on parse error', async () => {
      const mockResponse = {
        content: [
          {
            text: 'Invalid JSON response that cannot be parsed',
          },
        ],
      };

      mockMessagesCreate.mockResolvedValueOnce(mockResponse as any);

      const result = await service.classifyIntent(
        'test message',
        [],
        mockUserContext,
      );

      expect(result.intent).toBe('general_chat');
      expect(result.confidence).toBe(0.5);
      expect(result.reasoning).toContain('Failed to parse');
    });
  });

  describe('generateClarification', () => {
    const mockUserContext = {
      profile: {
        gender: 'male',
        primaryStyle: 'casual',
        priceRange: { min: 30, max: 150 },
      },
    };

    it('should generate natural clarification question', async () => {
      const mockResponse = {
        content: [
          {
            text: 'What type of clothing are you looking for? Like a shirt, pants, or maybe shoes?',
          },
        ],
      };

      mockMessagesCreate.mockResolvedValueOnce(mockResponse as any);

      const result = await service.generateClarification(
        'I need something',
        ['itemType'],
        mockUserContext,
      );

      expect(result).toContain('type of clothing');
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 256,
        }),
      );
    });

    it('should handle clarification generation error with fallback', async () => {
      mockMessagesCreate.mockRejectedValueOnce(
        new Error('API timeout'),
      );

      const result = await service.generateClarification(
        'test',
        ['occasion'],
        mockUserContext,
      );

      expect(result).toBe(
        "Could you tell me a bit more about what you're looking for?",
      );
    });

    it('should include user profile context in system prompt', async () => {
      const mockResponse = {
        content: [{ text: 'What occasion is this for?' }],
      };

      mockMessagesCreate.mockResolvedValueOnce(mockResponse as any);

      await service.generateClarification(
        'I need an outfit',
        ['occasion'],
        mockUserContext,
      );

      const callArgs = mockMessagesCreate.mock.calls[0][0];
      expect(callArgs.system).toContain('Gender: male');
      expect(callArgs.system).toContain('Style: casual');
      expect(callArgs.system).toContain('$30-150');
    });
  });

  describe('edge cases', () => {
    it('should handle empty conversation history', async () => {
      const mockResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'general_chat',
              confidence: 0.9,
              filters: {},
              reasoning: 'test',
            }),
          },
        ],
      };

      mockMessagesCreate.mockResolvedValueOnce(mockResponse as any);

      const result = await service.classifyIntent('hi', [], {});

      expect(result).toBeDefined();
      expect(result.intent).toBe('general_chat');
    });

    it('should handle missing user profile gracefully', async () => {
      const mockResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'product_search',
              confidence: 0.85,
              filters: {},
              reasoning: 'test',
            }),
          },
        ],
      };

      mockMessagesCreate.mockResolvedValueOnce(mockResponse as any);

      const result = await service.classifyIntent('show me shirts', [], {});

      expect(result).toBeDefined();
      const callArgs = mockMessagesCreate.mock.calls[0][0];
      expect(callArgs.system).toContain('not specified');
    });

    it('should truncate long conversation history', async () => {
      const mockResponse = {
        content: [
          {
            text: JSON.stringify({
              intent: 'product_search',
              confidence: 0.9,
              filters: {},
              reasoning: 'test',
            }),
          },
        ],
      };

      mockMessagesCreate.mockResolvedValueOnce(mockResponse as any);

      // Create 10 messages in history
      const longHistory = Array(10)
        .fill(null)
        .map((_, i) => ({
          role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
          content: `Message ${i}`,
        }));

      await service.classifyIntent('new message', longHistory, {});

      const callArgs = mockMessagesCreate.mock.calls[0][0];
      // Should only include last 5 messages from history + new message = 6 total
      expect(callArgs.messages.length).toBe(6);
    });
  });
});
