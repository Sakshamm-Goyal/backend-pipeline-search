import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from '../gemini.service';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Mock the Google Generative AI SDK
jest.mock('@google/generative-ai');

describe('GeminiService', () => {
  let service: GeminiService;
  let mockGenAI: jest.Mocked<GoogleGenerativeAI>;
  let mockModel: any;
  let configService: ConfigService;

  const mockApiKey = 'test-gemini-api-key-12345';

  beforeEach(async () => {
    // Setup mock ConfigService
    const mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'GOOGLE_AI_API_KEY') return mockApiKey;
        return null;
      }),
    };

    // Setup mock model
    mockModel = {
      generateContent: jest.fn(),
    };

    // Setup mock GoogleGenerativeAI
    mockGenAI = {
      getGenerativeModel: jest.fn().mockReturnValue(mockModel),
    } as any;

    (GoogleGenerativeAI as jest.MockedClass<typeof GoogleGenerativeAI>).mockImplementation(
      () => mockGenAI,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<GeminiService>(GeminiService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should throw error if GOOGLE_AI_API_KEY is missing', async () => {
      const mockConfigServiceNoKey = {
        get: jest.fn(() => null),
      };

      await expect(
        Test.createTestingModule({
          providers: [
            GeminiService,
            {
              provide: ConfigService,
              useValue: mockConfigServiceNoKey,
            },
          ],
        }).compile(),
      ).rejects.toThrow('GOOGLE_AI_API_KEY is required in environment variables');
    });

    it('should initialize with correct model configuration', () => {
      expect(mockGenAI.getGenerativeModel).toHaveBeenCalledWith({
        model: 'gemini-1.5-pro',
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      });
    });
  });

  describe('generateOutfitRecommendations', () => {
    const mockUserContext = {
      profile: {
        gender: 'female',
        primaryStyle: 'minimal',
        selectedStyles: ['casual', 'modern'],
        likedBrands: ['Everlane', 'COS'],
        colorPreferences: ['black', 'white', 'navy'],
        avoidColors: ['orange'],
        priceRange: { min: 50, max: 300 },
        modestDressing: false,
      },
      wardrobeColors: ['black', 'white', 'gray'],
      compatiblePieces: [
        { category: 'shoes', name: 'White sneakers', color: 'white' },
        { category: 'bag', name: 'Black leather bag', color: 'black' },
      ],
    };

    const mockSlotProducts = new Map([
      [
        'top',
        [
          {
            id: 'top-1',
            title: 'Black T-Shirt',
            price: 45,
            brand: 'Everlane',
            color: 'black',
          },
          {
            id: 'top-2',
            title: 'White Blouse',
            price: 80,
            brand: 'COS',
            color: 'white',
          },
        ],
      ],
      [
        'bottom',
        [
          {
            id: 'bottom-1',
            title: 'Navy Jeans',
            price: 120,
            brand: 'Everlane',
            color: 'navy',
          },
          {
            id: 'bottom-2',
            title: 'Black Trousers',
            price: 95,
            brand: 'COS',
            color: 'black',
          },
        ],
      ],
    ]);

    const mockFilters = {
      occasion: 'casual',
      style: 'minimal',
    };

    it('should generate 3 outfit recommendations', async () => {
      const mockResponse = {
        response: {
          text: () =>
            JSON.stringify({
              outfits: [
                {
                  name: 'Minimalist Everyday',
                  style: 'casual',
                  items: [
                    {
                      slot: 'top',
                      productId: 'top-1',
                      selectionReason: 'Classic black tee for versatile styling',
                    },
                    {
                      slot: 'bottom',
                      productId: 'bottom-1',
                      selectionReason: 'Navy jeans complement the black top',
                    },
                  ],
                  totalPrice: 165,
                  colorScheme: 'neutral',
                  styleNotes: 'Effortlessly chic and comfortable',
                  wardrobeSynergy: 'Pairs perfectly with your white sneakers',
                  occasionFit: 'Perfect for everyday casual outings',
                },
                {
                  name: 'Monochrome Chic',
                  style: 'casual',
                  items: [
                    {
                      slot: 'top',
                      productId: 'top-2',
                      selectionReason: 'White creates clean minimal look',
                    },
                    {
                      slot: 'bottom',
                      productId: 'bottom-2',
                      selectionReason: 'Black trousers elevate the outfit',
                    },
                  ],
                  totalPrice: 175,
                  colorScheme: 'monochromatic',
                  styleNotes: 'Sophisticated black and white combination',
                  wardrobeSynergy: 'Matches your black leather bag perfectly',
                  occasionFit: 'Versatile for casual to smart-casual occasions',
                },
                {
                  name: 'Navy Blues',
                  style: 'casual',
                  items: [
                    {
                      slot: 'top',
                      productId: 'top-2',
                      selectionReason: 'White top brightens the look',
                    },
                    {
                      slot: 'bottom',
                      productId: 'bottom-1',
                      selectionReason: 'Navy jeans add depth',
                    },
                  ],
                  totalPrice: 200,
                  colorScheme: 'complementary',
                  styleNotes: 'Classic nautical-inspired palette',
                  wardrobeSynergy: 'Works with both your white sneakers and black bag',
                  occasionFit: 'Great for casual weekend activities',
                },
              ],
            }),
        },
      };

      mockModel.generateContent.mockResolvedValueOnce(mockResponse);

      const result = await service.generateOutfitRecommendations(
        'I need casual outfits for everyday wear',
        mockUserContext,
        mockSlotProducts,
        mockFilters,
      );

      expect(result).toHaveLength(3);
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('style');
      expect(result[0]).toHaveProperty('items');
      expect(result[0]).toHaveProperty('totalPrice');
      expect(result[0]).toHaveProperty('colorScheme');
      expect(result[0].items).toHaveLength(2);
      expect(result[0].totalPrice).toBe(165);
    });

    it('should include user preferences in prompt', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({ outfits: [] }),
        },
      };

      mockModel.generateContent.mockResolvedValueOnce(mockResponse);

      await service.generateOutfitRecommendations(
        'casual outfits',
        mockUserContext,
        mockSlotProducts,
        mockFilters,
      );

      const callArgs = mockModel.generateContent.mock.calls[0][0];
      expect(callArgs).toContain('Gender: female');
      expect(callArgs).toContain('Primary Style: minimal');
      expect(callArgs).toContain('Liked Brands: Everlane, COS');
      expect(callArgs).toContain('Color Preferences: black, white, navy');
      expect(callArgs).toContain('Colors to Avoid: orange');
    });

    it('should handle missing user profile gracefully', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({ outfits: [] }),
        },
      };

      mockModel.generateContent.mockResolvedValueOnce(mockResponse);

      const minimalContext = {};

      const result = await service.generateOutfitRecommendations(
        'show me outfits',
        minimalContext,
        mockSlotProducts,
        {},
      );

      expect(result).toEqual([]);
      const callArgs = mockModel.generateContent.mock.calls[0][0];
      expect(callArgs).toContain('not specified');
    });

    it('should limit products to 10 per slot in prompt', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({ outfits: [] }),
        },
      };

      mockModel.generateContent.mockResolvedValueOnce(mockResponse);

      // Create 15 products for a slot
      const manyProducts = Array(15)
        .fill(null)
        .map((_, i) => ({
          id: `product-${i}`,
          title: `Product ${i}`,
          price: 50 + i,
          brand: 'Brand',
          color: 'blue',
        }));

      const largeSlotProducts = new Map([['top', manyProducts]]);

      await service.generateOutfitRecommendations(
        'test',
        mockUserContext,
        largeSlotProducts,
        {},
      );

      const callArgs = mockModel.generateContent.mock.calls[0][0];
      expect(callArgs).toContain('and 5 more options');
    });

    it('should handle API errors', async () => {
      mockModel.generateContent.mockRejectedValueOnce(
        new Error('API quota exceeded'),
      );

      await expect(
        service.generateOutfitRecommendations(
          'test',
          mockUserContext,
          mockSlotProducts,
          mockFilters,
        ),
      ).rejects.toThrow('API quota exceeded');
    });

    it('should handle invalid JSON response', async () => {
      const mockResponse = {
        response: {
          text: () => 'Invalid JSON response',
        },
      };

      mockModel.generateContent.mockResolvedValueOnce(mockResponse);

      const result = await service.generateOutfitRecommendations(
        'test',
        mockUserContext,
        mockSlotProducts,
        mockFilters,
      );

      expect(result).toEqual([]);
    });

    it('should handle response without outfits array', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({ error: 'No outfits generated' }),
        },
      };

      mockModel.generateContent.mockResolvedValueOnce(mockResponse);

      const result = await service.generateOutfitRecommendations(
        'test',
        mockUserContext,
        mockSlotProducts,
        mockFilters,
      );

      expect(result).toEqual([]);
    });
  });

  describe('rerankProducts', () => {
    const mockProducts = [
      {
        id: '1',
        title: 'Nike Air Max',
        price: 150,
        brand: 'Nike',
        color: 'white',
      },
      {
        id: '2',
        title: 'Adidas Ultraboost',
        price: 180,
        brand: 'Adidas',
        color: 'black',
      },
      {
        id: '3',
        title: 'Converse Chuck Taylor',
        price: 60,
        brand: 'Converse',
        color: 'white',
      },
      {
        id: '4',
        title: 'Vans Old Skool',
        price: 70,
        brand: 'Vans',
        color: 'black',
      },
    ];

    const mockPreferences = {
      likedBrands: ['Nike', 'Adidas'],
      colorPreferences: ['white', 'gray'],
      priceRange: { min: 50, max: 200 },
    };

    it('should rerank products successfully', async () => {
      const mockResponse = {
        response: {
          text: () =>
            JSON.stringify({
              ranking: [1, 3, 2, 4], // Prefer Nike, then Converse, then Adidas, then Vans
              reasoning:
                'Nike and Adidas match liked brands, white color preferred',
            }),
        },
      };

      mockModel.generateContent.mockResolvedValueOnce(mockResponse);

      const result = await service.rerankProducts(
        mockProducts,
        mockPreferences,
        'casual sneakers for everyday wear',
      );

      expect(result).toHaveLength(4);
      expect(result[0].product.id).toBe('1'); // Nike ranked first
      expect(result[0].newRank).toBe(1);
      expect(result[0].originalRank).toBe(1);
      expect(result[1].product.id).toBe('3'); // Converse ranked second
      expect(result[1].newRank).toBe(2);
      expect(result[1].originalRank).toBe(3);
    });

    it('should handle empty product array', async () => {
      const result = await service.rerankProducts([], mockPreferences, 'test');

      expect(result).toEqual([]);
      expect(mockModel.generateContent).not.toHaveBeenCalled();
    });

    it('should include preferences in prompt', async () => {
      const mockResponse = {
        response: {
          text: () =>
            JSON.stringify({
              ranking: [1, 2, 3, 4],
              reasoning: 'test',
            }),
        },
      };

      mockModel.generateContent.mockResolvedValueOnce(mockResponse);

      await service.rerankProducts(
        mockProducts,
        mockPreferences,
        'searching for sneakers',
      );

      const callArgs = mockModel.generateContent.mock.calls[0][0];
      expect(callArgs).toContain('USER PREFERENCES:');
      expect(callArgs).toContain('"Nike"');
      expect(callArgs).toContain('"Adidas"');
      expect(callArgs).toContain('CONTEXT: searching for sneakers');
    });

    it('should fallback to original order on API error', async () => {
      mockModel.generateContent.mockRejectedValueOnce(
        new Error('API timeout'),
      );

      const result = await service.rerankProducts(
        mockProducts,
        mockPreferences,
        'test',
      );

      expect(result).toHaveLength(4);
      expect(result[0].product.id).toBe('1');
      expect(result[0].newRank).toBe(1);
      expect(result[0].originalRank).toBe(1);
      expect(result[0].reasoning).toContain(
        'Reranking failed, using original order',
      );
    });

    it('should fallback to original order on invalid JSON', async () => {
      const mockResponse = {
        response: {
          text: () => 'Invalid JSON',
        },
      };

      mockModel.generateContent.mockResolvedValueOnce(mockResponse);

      const result = await service.rerankProducts(
        mockProducts,
        mockPreferences,
        'test',
      );

      expect(result).toHaveLength(4);
      result.forEach((item, index) => {
        expect(item.newRank).toBe(index + 1);
        expect(item.originalRank).toBe(index + 1);
      });
    });

    it('should handle partial ranking gracefully', async () => {
      const mockResponse = {
        response: {
          text: () =>
            JSON.stringify({
              ranking: [1, 2], // Only 2 items instead of 4
              reasoning: 'partial ranking',
            }),
        },
      };

      mockModel.generateContent.mockResolvedValueOnce(mockResponse);

      const result = await service.rerankProducts(
        mockProducts,
        mockPreferences,
        'test',
      );

      // Should only return the items that were ranked
      expect(result.length).toBeLessThanOrEqual(4);
      expect(result.every(item => item.product)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty slot products map', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({ outfits: [] }),
        },
      };

      mockModel.generateContent.mockResolvedValueOnce(mockResponse);

      const emptySlots = new Map();

      const result = await service.generateOutfitRecommendations(
        'test',
        {},
        emptySlots,
        {},
      );

      expect(result).toEqual([]);
    });

    it('should format compatible pieces correctly', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({ outfits: [] }),
        },
      };

      mockModel.generateContent.mockResolvedValueOnce(mockResponse);

      const contextWithPieces = {
        compatiblePieces: [
          { category: 'shoes', name: 'White sneakers', color: 'white' },
          { category: 'bag', name: 'Black bag', color: 'black' },
        ],
      };

      await service.generateOutfitRecommendations(
        'test',
        contextWithPieces,
        new Map(),
        {},
      );

      const callArgs = mockModel.generateContent.mock.calls[0][0];
      expect(callArgs).toContain('shoes: White sneakers (white)');
      expect(callArgs).toContain('bag: Black bag (black)');
    });

    it('should handle missing colors in products', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({ outfits: [] }),
        },
      };

      mockModel.generateContent.mockResolvedValueOnce(mockResponse);

      const productsWithoutColor = new Map([
        [
          'top',
          [
            {
              id: 'top-1',
              title: 'T-Shirt',
              price: 50,
              brand: 'Brand',
              // color missing
            },
          ],
        ],
      ]);

      await service.generateOutfitRecommendations(
        'test',
        {},
        productsWithoutColor,
        {},
      );

      const callArgs = mockModel.generateContent.mock.calls[0][0];
      expect(callArgs).toContain('[Color: N/A]');
    });
  });

  describe('performance', () => {
    it('should log duration for outfit generation', async () => {
      const mockResponse = {
        response: {
          text: () =>
            JSON.stringify({
              outfits: [
                {
                  name: 'Test Outfit',
                  style: 'casual',
                  items: [],
                  totalPrice: 100,
                  colorScheme: 'neutral',
                  styleNotes: 'test',
                  wardrobeSynergy: 'test',
                  occasionFit: 'test',
                },
              ],
            }),
        },
      };

      mockModel.generateContent.mockResolvedValueOnce(mockResponse);

      const loggerSpy = jest.spyOn(service['logger'], 'log');

      await service.generateOutfitRecommendations(
        'test',
        {},
        new Map(),
        {},
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Generated 1 outfit recommendations in'),
      );
    });

    it('should log reranking results', async () => {
      const mockResponse = {
        response: {
          text: () =>
            JSON.stringify({
              ranking: [1, 2],
              reasoning: 'test',
            }),
        },
      };

      mockModel.generateContent.mockResolvedValueOnce(mockResponse);

      const loggerSpy = jest.spyOn(service['logger'], 'log');

      await service.rerankProducts(
        [
          { id: '1', title: 'Product 1', price: 50 },
          { id: '2', title: 'Product 2', price: 60 },
        ],
        {},
        'test',
      );

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Reranked 2 products'),
      );
    });
  });
});
