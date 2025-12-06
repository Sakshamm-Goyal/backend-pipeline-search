import { Test, TestingModule } from '@nestjs/testing';
import { SearchAgentService } from './search-agent.service';
import { SearchOrchestratorService } from '../../search/search-orchestrator.service';
import { AgentType, RoutingDecision } from './intent-router.service';
import { ResponseType } from '../dto/chat-message.dto';
import { SearchResult, Product, SearchSource } from '../../search/dto/product.dto';
import { ProductRepository } from '../../products/infrastructure/persistence/product.repository';

describe('SearchAgentService', () => {
  let service: SearchAgentService;
  let searchOrchestrator: jest.Mocked<SearchOrchestratorService>;
  let productRepository: jest.Mocked<ProductRepository>;

  const mockRoutingDecision: RoutingDecision = {
    agent: AgentType.SEARCH,
    intent: 'product_search',
    confidence: 0.9,
    filters: {
      gender: 'female',
      category: 'dress',
      color: 'red',
    },
    needsClarification: false,
    reasoning: 'User wants red dresses',
    processingTime: 100,
  };

  const mockProducts: Product[] = [
    {
      id: 'prod-1',
      sourceId: 'src-1',
      source: SearchSource.OXYLABS,
      title: 'Red Evening Dress',
      brand: 'Brand A',
      retailer: 'Store A',
      price: 120,
      currency: 'USD',
      onSale: false,
      imageUrl: 'https://example.com/image1.jpg',
      productUrl: 'https://example.com/product1',
      inStock: true,
      scrapedAt: new Date(),
      score: 95,
    },
    {
      id: 'prod-2',
      sourceId: 'src-2',
      source: SearchSource.SHOPSTYLE,
      title: 'Red Cocktail Dress',
      brand: 'Brand B',
      retailer: 'Store B',
      price: 89.99,
      currency: 'USD',
      onSale: false,
      imageUrl: 'https://example.com/image2.jpg',
      productUrl: 'https://example.com/product2',
      inStock: true,
      scrapedAt: new Date(),
      score: 88,
    },
  ];

  const mockSearchResult: SearchResult = {
    products: mockProducts,
    totalFound: 42,
    page: 1,
    perPage: 20,
    sources: [SearchSource.OXYLABS, SearchSource.SHOPSTYLE],
    timing: {
      total: 2500,
      bySource: { oxylabs: 1200, shopstyle: 1300 },
    },
    metadata: {
      query: 'red dresses',
      filters: { gender: 'female', category: 'dress' },
      cacheHit: false,
    },
  };

  beforeEach(async () => {
    const mockSearchOrchestratorService = {
      search: jest.fn(),
    };

    const mockProductRepository = {
      findById: jest.fn(),
      findByExternalId: jest.fn(),
      findSimilarByAttributes: jest.fn(),
      incrementViewCount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchAgentService,
        {
          provide: SearchOrchestratorService,
          useValue: mockSearchOrchestratorService,
        },
        {
          provide: ProductRepository,
          useValue: mockProductRepository,
        },
      ],
    }).compile();

    service = module.get<SearchAgentService>(SearchAgentService);
    searchOrchestrator = module.get(SearchOrchestratorService) as jest.Mocked<SearchOrchestratorService>;
    productRepository = module.get(ProductRepository) as jest.Mocked<ProductRepository>;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('execute', () => {
    it('should search for products and return formatted response', async () => {
      searchOrchestrator.search.mockResolvedValue(mockSearchResult);

      const result = await service.execute(
        'Show me red dresses',
        mockRoutingDecision,
      );

      expect(result.type).toBe(ResponseType.PRODUCT_LIST);
      expect(result.data.products).toHaveLength(2);
      expect(result.data.totalFound).toBe(42);
      // Message format is dynamic based on count: "I found X great options for you!"
      expect(result.message).toContain('2');
    });

    it('should pass filters from routing decision to search', async () => {
      searchOrchestrator.search.mockResolvedValue(mockSearchResult);

      await service.execute('Show me red dresses', mockRoutingDecision);

      expect(searchOrchestrator.search).toHaveBeenCalledWith(
        expect.objectContaining({
          terms: expect.stringContaining('red'),
        }),
        undefined,
      );
    });

    it('should pass user context to search orchestrator', async () => {
      searchOrchestrator.search.mockResolvedValue(mockSearchResult);

      const userContext = {
        gender: 'female',
        sizes: { dress: '8' },
      };

      await service.execute(
        'Find dresses for me',
        mockRoutingDecision,
        userContext,
      );

      expect(searchOrchestrator.search).toHaveBeenCalledWith(
        expect.any(Object),
        userContext,
      );
    });

    it('should include suggested actions in response', async () => {
      searchOrchestrator.search.mockResolvedValue(mockSearchResult);

      const result = await service.execute(
        'Show me dresses',
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

    it('should handle empty search results', async () => {
      const emptyResult: SearchResult = {
        products: [],
        totalFound: 0,
        page: 1,
        perPage: 20,
        sources: [SearchSource.OXYLABS],
        timing: {
          total: 1500,
          bySource: { oxylabs: 1500 },
        },
        metadata: {
          query: 'purple unicorn dresses',
          filters: {},
          cacheHit: false,
        },
      };

      searchOrchestrator.search.mockResolvedValue(emptyResult);

      const result = await service.execute(
        'Show me purple unicorn dresses',
        mockRoutingDecision,
      );

      // When no products found, returns TEXT type with no results message
      expect(result.type).toBe(ResponseType.TEXT);
      expect(result.message).toContain("couldn't find");
    });

    it('should include metadata in response', async () => {
      searchOrchestrator.search.mockResolvedValue(mockSearchResult);

      const result = await service.execute(
        'Show me dresses',
        mockRoutingDecision,
      );

      expect(result.metadata).toBeDefined();
      expect(result.metadata?.processingTime).toBeGreaterThanOrEqual(0);
      expect(result.metadata?.agentUsed).toBe('search');
    });

    it('should handle search orchestrator errors gracefully', async () => {
      searchOrchestrator.search.mockRejectedValue(
        new Error('Search failed'),
      );

      // Service handles errors gracefully and returns an error response
      const result = await service.execute('Show me dresses', mockRoutingDecision);

      expect(result.type).toBe(ResponseType.ERROR);
      expect(result.message).toContain('having trouble');
    });

    it('should build search query from message and filters', async () => {
      searchOrchestrator.search.mockResolvedValue(mockSearchResult);

      const routing: RoutingDecision = {
        ...mockRoutingDecision,
        filters: {
          gender: 'female',
          category: 'shoes',
          color: 'black',
          brand: 'Nike',
        },
      };

      await service.execute('Nike black shoes', routing);

      const searchQuery = searchOrchestrator.search.mock.calls[0][0];
      // Search terms are normalized to lowercase
      expect(searchQuery.terms.toLowerCase()).toContain('nike');
      expect(searchQuery.terms.toLowerCase()).toContain('black');
      expect(searchQuery.terms.toLowerCase()).toContain('shoes');
    });

    it('should return all products from search results', async () => {
      const manyProducts = Array.from({ length: 50 }, (_, i) => ({
        ...mockProducts[0],
        id: `prod-${i}`,
        title: `Product ${i}`,
      }));

      const largeResult: SearchResult = {
        ...mockSearchResult,
        products: manyProducts,
        totalFound: 150,
      };

      searchOrchestrator.search.mockResolvedValue(largeResult);

      const result = await service.execute(
        'Show me dresses',
        mockRoutingDecision,
      );

      // Service returns all products from orchestrator (orchestrator handles pagination)
      expect(result.data.products).toHaveLength(50);
      expect(result.data.totalFound).toBe(150);
    });

    it('should provide refinement suggestions based on results', async () => {
      searchOrchestrator.search.mockResolvedValue(mockSearchResult);

      const result = await service.execute(
        'Show me dresses',
        mockRoutingDecision,
      );

      const refineSuggestions = result.suggestedActions?.filter(
        (a) => a.action === 'refine' || a.action.includes('refine'),
      );

      expect(refineSuggestions).toBeDefined();
    });

    it('should handle cached search results', async () => {
      const cachedResult: SearchResult = {
        ...mockSearchResult,
        timing: {
          total: 50,
          bySource: { cache: 50 },
        },
        metadata: {
          ...mockSearchResult.metadata!,
          cacheHit: true,
        },
      };

      searchOrchestrator.search.mockResolvedValue(cachedResult);

      const result = await service.execute(
        'Show me dresses',
        mockRoutingDecision,
      );

      expect(result.metadata).toBeDefined();
      expect(result.metadata?.processingTime).toBeDefined();
    });
  });

  describe('getProductDetails', () => {
    const mockProductDoc = {
      _id: { toString: () => 'mongo-id-123' },
      sourceId: 'src-123',
      source: 'oxylabs',
      title: 'Test Product',
      description: 'A test product',
      brand: 'Test Brand',
      retailer: 'Test Store',
      category: 'dress',
      color: 'red',
      pricing: {
        current: 99.99,
        original: 129.99,
        currency: 'USD',
        onSale: true,
        discountPercent: 23,
      },
      images: {
        primary: 'https://example.com/image.jpg',
        gallery: [],
        thumbnail: 'https://example.com/thumb.jpg',
      },
      productUrl: 'https://example.com/product',
      affiliateUrl: 'https://example.com/affiliate',
      rating: { average: 4.5, count: 100 },
      availability: {
        inStock: true,
        stockLevel: 'high',
        sizes: ['S', 'M', 'L'],
        colors: ['red', 'blue'],
      },
      style: {
        tags: ['casual', 'summer'],
        pattern: 'solid',
        material: 'cotton',
        sustainable: true,
      },
      searchMeta: { relevanceScore: 95 },
      scrapedAt: new Date(),
    };

    it('should return product details when found by ID', async () => {
      productRepository.findById.mockResolvedValue(mockProductDoc as any);
      productRepository.incrementViewCount.mockResolvedValue(undefined);

      const result = await service.getProductDetails('mongo-id-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('mongo-id-123');
      expect(result?.title).toBe('Test Product');
      expect(productRepository.incrementViewCount).toHaveBeenCalled();
    });

    it('should try external ID if MongoDB ID not found', async () => {
      productRepository.findById.mockResolvedValue(null);
      productRepository.findByExternalId.mockResolvedValue(mockProductDoc as any);
      productRepository.incrementViewCount.mockResolvedValue(undefined);

      const result = await service.getProductDetails('external-id');

      expect(productRepository.findById).toHaveBeenCalled();
      expect(productRepository.findByExternalId).toHaveBeenCalledWith('external-id');
      expect(result).toBeDefined();
    });

    it('should return null when product not found', async () => {
      productRepository.findById.mockResolvedValue(null);
      productRepository.findByExternalId.mockResolvedValue(null);

      const result = await service.getProductDetails('nonexistent-id');

      expect(result).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      productRepository.findById.mockRejectedValue(new Error('Database error'));

      const result = await service.getProductDetails('some-id');

      expect(result).toBeNull();
    });
  });

  describe('findSimilar', () => {
    const mockSimilarProducts = [
      {
        _id: { toString: () => 'similar-1' },
        sourceId: 'src-1',
        source: 'oxylabs',
        title: 'Similar Product 1',
        brand: 'Brand A',
        retailer: 'Store A',
        pricing: { current: 100, currency: 'USD', onSale: false },
        images: { primary: 'https://example.com/1.jpg', gallery: [] },
        productUrl: 'https://example.com/1',
        availability: { inStock: true, sizes: [], colors: [] },
        scrapedAt: new Date(),
      },
      {
        _id: { toString: () => 'similar-2' },
        sourceId: 'src-2',
        source: 'shopstyle',
        title: 'Similar Product 2',
        brand: 'Brand B',
        retailer: 'Store B',
        pricing: { current: 110, currency: 'USD', onSale: false },
        images: { primary: 'https://example.com/2.jpg', gallery: [] },
        productUrl: 'https://example.com/2',
        availability: { inStock: true, sizes: [], colors: [] },
        scrapedAt: new Date(),
      },
    ];

    it('should return similar products', async () => {
      productRepository.findSimilarByAttributes.mockResolvedValue(mockSimilarProducts as any);

      const result = await service.findSimilar('product-id');

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Similar Product 1');
      expect(productRepository.findSimilarByAttributes).toHaveBeenCalledWith('product-id', 10);
    });

    it('should return empty array when no similar products found', async () => {
      productRepository.findSimilarByAttributes.mockResolvedValue([]);

      const result = await service.findSimilar('product-id');

      expect(result).toHaveLength(0);
    });

    it('should handle errors gracefully', async () => {
      productRepository.findSimilarByAttributes.mockRejectedValue(new Error('Database error'));

      const result = await service.findSimilar('product-id');

      expect(result).toHaveLength(0);
    });
  });
});
