import { Test, TestingModule } from '@nestjs/testing';
import { OutfitGeneratorAgentService } from './outfit-generator-agent.service';
import { SearchOrchestratorService } from '../../search/search-orchestrator.service';
import { GeminiService, OutfitRecommendation } from '../../infrastructure/llm/gemini.service';
import { AgentType, RoutingDecision } from './intent-router.service';
import { ResponseType } from '../dto/chat-message.dto';
import { SearchResult, Product, SearchSource } from '../../search/dto/product.dto';

describe('OutfitGeneratorAgentService', () => {
  let service: OutfitGeneratorAgentService;
  let searchOrchestrator: jest.Mocked<SearchOrchestratorService>;
  let geminiService: jest.Mocked<GeminiService>;

  const mockRoutingDecision: RoutingDecision = {
    agent: AgentType.OUTFIT_GENERATOR,
    intent: 'outfit_generation',
    confidence: 0.88,
    filters: {
      gender: 'female',
      occasion: 'professional',
    },
    needsClarification: false,
    reasoning: 'User wants outfit for job interview',
    processingTime: 150,
  };

  const mockProduct: Product = {
    id: 'prod-1',
    sourceId: 'src-1',
    source: SearchSource.OXYLABS,
    title: 'White Blazer',
    brand: 'Brand A',
    retailer: 'Store A',
    price: 120,
    currency: 'USD',
    onSale: false,
    imageUrl: 'https://example.com/blazer.jpg',
    productUrl: 'https://example.com/product1',
    inStock: true,
    scrapedAt: new Date(),
    score: 95,
  };

  const mockSlotProducts = {
    top: [
      { ...mockProduct, id: 'top-1', title: 'White Blouse' },
      { ...mockProduct, id: 'top-2', title: 'Blue Shirt' },
    ],
    bottom: [
      { ...mockProduct, id: 'bottom-1', title: 'Black Trousers' },
      { ...mockProduct, id: 'bottom-2', title: 'Navy Skirt' },
    ],
    shoes: [
      { ...mockProduct, id: 'shoes-1', title: 'Black Heels' },
      { ...mockProduct, id: 'shoes-2', title: 'Brown Loafers' },
    ],
  };

  const mockOutfits: OutfitRecommendation[] = [
    {
      name: 'Professional Power Look',
      style: 'professional',
      items: [
        { slot: 'top', productId: 'top-1', selectionReason: 'Classic blouse for interviews' },
        { slot: 'bottom', productId: 'bottom-1', selectionReason: 'Tailored trousers for a polished look' },
        { slot: 'shoes', productId: 'shoes-1', selectionReason: 'Elegant heels complete the ensemble' },
      ],
      totalPrice: 360,
      colorScheme: 'Black and white monochrome',
      styleNotes: 'Classic professional look with clean lines',
      wardrobeSynergy: 'Versatile pieces work well with existing wardrobe',
      occasionFit: 'Perfect for job interviews',
    },
    {
      name: 'Smart Casual',
      style: 'business casual',
      items: [
        { slot: 'top', productId: 'top-2', selectionReason: 'Blue shirt adds color' },
        { slot: 'bottom', productId: 'bottom-2', selectionReason: 'Navy skirt is versatile' },
        { slot: 'shoes', productId: 'shoes-2', selectionReason: 'Comfortable loafers' },
      ],
      totalPrice: 330,
      colorScheme: 'Blue and navy tones',
      styleNotes: 'Comfortable yet polished for long workdays',
      wardrobeSynergy: 'Pairs well with neutral basics',
      occasionFit: 'Great for office environment',
    },
  ];

  beforeEach(async () => {
    const mockSearchOrchestratorService = {
      search: jest.fn(),
    };

    const mockGeminiService = {
      generateOutfitRecommendations: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutfitGeneratorAgentService,
        {
          provide: SearchOrchestratorService,
          useValue: mockSearchOrchestratorService,
        },
        {
          provide: GeminiService,
          useValue: mockGeminiService,
        },
      ],
    }).compile();

    service = module.get<OutfitGeneratorAgentService>(OutfitGeneratorAgentService);
    searchOrchestrator = module.get(SearchOrchestratorService) as jest.Mocked<SearchOrchestratorService>;
    geminiService = module.get(GeminiService) as jest.Mocked<GeminiService>;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('execute', () => {
    beforeEach(() => {
      // Mock search orchestrator to return products for each slot
      searchOrchestrator.search.mockImplementation(async (query): Promise<SearchResult> => {
        const products = query.terms.includes('top')
          ? mockSlotProducts.top
          : query.terms.includes('bottom')
            ? mockSlotProducts.bottom
            : mockSlotProducts.shoes;

        return {
          products,
          totalFound: products.length,
          page: 1,
          perPage: 20,
          sources: [SearchSource.OXYLABS],
          timing: {
            total: 1000,
            bySource: { oxylabs: 1000 },
          },
          metadata: {
            query: query.terms,
            filters: {},
            cacheHit: false,
          },
        };
      });

      geminiService.generateOutfitRecommendations.mockResolvedValue(mockOutfits);
    });

    it('should generate outfit recommendations', async () => {
      const result = await service.execute(
        'Create a professional outfit for a job interview',
        mockRoutingDecision,
      );

      expect(result.type).toBe(ResponseType.OUTFIT_RECOMMENDATIONS);
      expect(result.data.outfits).toHaveLength(2);
      expect(result.message).toContain('outfit');
    });

    it('should search for products in multiple slots', async () => {
      await service.execute(
        'Professional outfit',
        mockRoutingDecision,
      );

      // With occasion filter, searches top, bottom, shoes, and outerwear (4 slots)
      expect(searchOrchestrator.search).toHaveBeenCalledTimes(4);
      expect(searchOrchestrator.search).toHaveBeenCalledWith(
        expect.objectContaining({
          terms: expect.stringContaining('top'),
        }),
        undefined,
      );
      expect(searchOrchestrator.search).toHaveBeenCalledWith(
        expect.objectContaining({
          terms: expect.stringContaining('bottom'),
        }),
        undefined,
      );
      expect(searchOrchestrator.search).toHaveBeenCalledWith(
        expect.objectContaining({
          terms: expect.stringContaining('shoes'),
        }),
        undefined,
      );
      expect(searchOrchestrator.search).toHaveBeenCalledWith(
        expect.objectContaining({
          terms: expect.stringContaining('outerwear'),
        }),
        undefined,
      );
    });

    it('should pass occasion filter to search for each slot', async () => {
      await service.execute(
        'Professional outfit',
        mockRoutingDecision,
      );

      const calls = searchOrchestrator.search.mock.calls;
      calls.forEach((call) => {
        expect(call[0].occasion).toBe('professional');
      });
    });

    it('should pass user context to search and Gemini', async () => {
      const userContext = {
        gender: 'female',
        style: 'professional',
        sizes: { top: 'M', bottom: '8' },
      };

      await service.execute(
        'Create outfit for me',
        mockRoutingDecision,
        userContext,
      );

      expect(searchOrchestrator.search).toHaveBeenCalledWith(
        expect.any(Object),
        userContext,
      );

      expect(geminiService.generateOutfitRecommendations).toHaveBeenCalledWith(
        expect.any(String),
        userContext,
        expect.any(Object),
        expect.any(Object),
      );
    });

    it('should call Gemini with slot products as Map', async () => {
      await service.execute(
        'Professional outfit',
        mockRoutingDecision,
      );

      // Gemini is called with a Map of slot products, not a plain object
      expect(geminiService.generateOutfitRecommendations).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        expect.any(Map),
        expect.any(Object),
      );

      const slotProducts = geminiService.generateOutfitRecommendations.mock.calls[0][2];
      expect(slotProducts).toBeInstanceOf(Map);
      expect(slotProducts.has('top')).toBe(true);
      expect(slotProducts.has('bottom')).toBe(true);
      expect(slotProducts.has('shoes')).toBe(true);
    });

    it('should include outfit metadata in response', async () => {
      const result = await service.execute(
        'Professional outfit',
        mockRoutingDecision,
      );

      expect(result.metadata).toBeDefined();
      expect(result.metadata?.processingTime).toBeGreaterThanOrEqual(0);
      expect(result.metadata?.agentUsed).toBe('outfit_generator');
    });

    it('should include suggested actions', async () => {
      const result = await service.execute(
        'Professional outfit',
        mockRoutingDecision,
      );

      expect(result.suggestedActions).toBeDefined();
      expect(result.suggestedActions!.length).toBeGreaterThan(0);
      expect(result.suggestedActions).toContainEqual(
        expect.objectContaining({
          action: expect.any(String),
          label: expect.any(String),
        }),
      );
    });

    it('should handle missing products in some slots', async () => {
      searchOrchestrator.search.mockImplementation(async (query): Promise<SearchResult> => {
        if (query.terms.includes('shoes')) {
          return {
            products: [],
            totalFound: 0,
            page: 1,
            perPage: 20,
            sources: [SearchSource.OXYLABS],
            timing: { total: 1000, bySource: { oxylabs: 1000 } },
            metadata: { query: query.terms, filters: {}, cacheHit: false },
          };
        }

        const products = query.terms.includes('top')
          ? mockSlotProducts.top
          : mockSlotProducts.bottom;

        return {
          products,
          totalFound: products.length,
          page: 1,
          perPage: 20,
          sources: [SearchSource.OXYLABS],
          timing: { total: 1000, bySource: { oxylabs: 1000 } },
          metadata: { query: query.terms, filters: {}, cacheHit: false },
        };
      });

      // Gemini should still generate outfits with available slots
      geminiService.generateOutfitRecommendations.mockResolvedValue([
        {
          ...mockOutfits[0],
          items: mockOutfits[0].items.filter((item) => item.slot !== 'shoes'),
        },
      ]);

      const result = await service.execute(
        'Professional outfit',
        mockRoutingDecision,
      );

      expect(result.type).toBe(ResponseType.OUTFIT_RECOMMENDATIONS);
      expect(result.data.outfits).toHaveLength(1);
    });

    it('should search for dress slot when dress is mentioned', async () => {
      const dressRouting: RoutingDecision = {
        ...mockRoutingDecision,
        filters: {
          gender: 'female',
          category: 'dress',
          occasion: 'wedding',
        },
      };

      await service.execute('Wedding dress outfit', dressRouting);

      expect(searchOrchestrator.search).toHaveBeenCalledWith(
        expect.objectContaining({
          terms: expect.stringContaining('dress'),
        }),
        undefined,
      );
    });

    it('should search for outerwear when occasion is specified', async () => {
      const winterRouting: RoutingDecision = {
        ...mockRoutingDecision,
        filters: {
          gender: 'female',
          occasion: 'outdoor',
          season: 'winter',
        },
      };

      await service.execute('Winter outdoor outfit', winterRouting);

      // With occasion filter, outerwear slot is searched
      const queries = searchOrchestrator.search.mock.calls.map((call) => call[0].terms);
      expect(queries.some((q: string) => q.includes('outerwear'))).toBe(true);
    });

    it('should handle Gemini service errors gracefully', async () => {
      geminiService.generateOutfitRecommendations.mockRejectedValue(
        new Error('Gemini API error'),
      );

      // Service handles errors gracefully and returns an error response
      const result = await service.execute('Professional outfit', mockRoutingDecision);

      expect(result.type).toBe(ResponseType.ERROR);
      expect(result.message).toContain('having trouble');
    });

    it('should handle search orchestrator errors gracefully', async () => {
      searchOrchestrator.search.mockRejectedValue(
        new Error('Search failed'),
      );

      // Service handles search errors gracefully - returns insufficient products response
      const result = await service.execute('Professional outfit', mockRoutingDecision);

      expect(result.type).toBe(ResponseType.TEXT);
      expect(result.message).toContain("couldn't find enough");
    });

    it('should limit products per slot to avoid overwhelming Gemini', async () => {
      const manyProducts = Array.from({ length: 50 }, (_, i) => ({
        ...mockProduct,
        id: `prod-${i}`,
        title: `Product ${i}`,
      }));

      searchOrchestrator.search.mockResolvedValue({
        products: manyProducts,
        totalFound: 100,
        page: 1,
        perPage: 20,
        sources: [SearchSource.OXYLABS],
        timing: { total: 1000, bySource: { oxylabs: 1000 } },
        metadata: { query: 'test', filters: {}, cacheHit: false },
      });

      await service.execute('Professional outfit', mockRoutingDecision);

      const slotProducts = geminiService.generateOutfitRecommendations.mock.calls[0][2];
      Object.values(slotProducts).forEach((products: any) => {
        expect(products.length).toBeLessThanOrEqual(10);
      });
    });
  });
});
