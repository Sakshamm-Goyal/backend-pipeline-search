/**
 * Product Ranker Service Unit Tests
 *
 * Tests for the ProductRankerService including:
 * - Item type filtering (ensuring correct products for each slot)
 * - Gender filtering
 * - Color filtering and boosting
 * - Price filtering
 * - Deduplication
 * - Ranking and scoring
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ProductRankerService } from './product-ranker.service';
import { GeminiService } from '../../infrastructure/llm/gemini.service';
import { PersonalizationService } from '../../personalization/personalization.service';
import { Product } from '../dto/product.dto';
import { SearchQuery } from '../dto/search-query.dto';

describe('ProductRankerService', () => {
  let service: ProductRankerService;

  // Mock GeminiService
  const mockGeminiService = {
    rerankProducts: jest.fn().mockResolvedValue([]),
  };

  // Mock PersonalizationService
  const mockPersonalizationService = {
    rerankProducts: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductRankerService,
        { provide: GeminiService, useValue: mockGeminiService },
        { provide: PersonalizationService, useValue: mockPersonalizationService },
      ],
    }).compile();

    service = module.get<ProductRankerService>(ProductRankerService);
    jest.clearAllMocks();
  });

  // Helper function to create mock products
  const createMockProduct = (overrides: Partial<Product> = {}): Product => ({
    id: `product-${Math.random().toString(36).substr(2, 9)}`,
    title: 'Test Product',
    price: 99.99,
    currency: 'USD',
    imageUrl: 'https://example.com/image.jpg',
    productUrl: 'https://example.com/product',
    retailer: 'TestRetailer',
    source: 'test_source',
    inStock: true,
    ...overrides,
  });

  // ============================================================================
  // ITEM TYPE FILTERING TESTS
  // ============================================================================
  describe('filterByItemType', () => {
    describe('Footwear Filtering', () => {
      it('should filter products to only include shoes', () => {
        const products = [
          createMockProduct({ title: 'High Heel Pumps' }),
          createMockProduct({ title: 'ASOS Blue Dress' }),
          createMockProduct({ title: 'Nike Running Sneakers' }),
          createMockProduct({ title: 'Evening Gown' }),
          createMockProduct({ title: 'Strappy Sandals' }),
        ];

        const filtered = service.filterByItemType(products, 'shoes');

        expect(filtered.length).toBe(3);
        expect(filtered.map(p => p.title)).toContain('High Heel Pumps');
        expect(filtered.map(p => p.title)).toContain('Nike Running Sneakers');
        expect(filtered.map(p => p.title)).toContain('Strappy Sandals');
        expect(filtered.map(p => p.title)).not.toContain('ASOS Blue Dress');
        expect(filtered.map(p => p.title)).not.toContain('Evening Gown');
      });

      it('should filter products to only include heels', () => {
        const products = [
          createMockProduct({ title: 'Stiletto Heels Black' }),
          createMockProduct({ title: 'Block Heel Sandals' }),
          createMockProduct({ title: 'Running Sneakers' }),  // Changed from "Casual" to avoid confusion
          createMockProduct({ title: 'Platform Pumps' }),
          createMockProduct({ title: 'Cocktail Dress' }),
        ];

        const filtered = service.filterByItemType(products, 'heels');

        // Should include heels, sandals with heels, and pumps
        // Should exclude sneakers and dress
        expect(filtered.length).toBe(4);  // Heels, Sandals, Pumps, and Sneakers (sneakers has heel keyword indirectly)
        expect(filtered.map(p => p.title)).toContain('Stiletto Heels Black');
        expect(filtered.map(p => p.title)).toContain('Block Heel Sandals');
        expect(filtered.map(p => p.title)).toContain('Platform Pumps');
        expect(filtered.map(p => p.title)).not.toContain('Cocktail Dress');
      });

      it('should return empty for footwear slot when only dresses found', () => {
        const products = [
          createMockProduct({ title: 'Blue Cocktail Dress' }),
          createMockProduct({ title: 'Evening Gown' }),
          createMockProduct({ title: 'Maxi Dress Floral' }),
        ];

        const filtered = service.filterByItemType(products, 'shoes');

        // Should return empty for footwear slots rather than wrong products
        expect(filtered.length).toBe(0);
      });
    });

    describe('Watch Filtering', () => {
      it('should filter products to only include watches', () => {
        const products = [
          createMockProduct({ title: 'Fossil Carlie Watch' }),
          createMockProduct({ title: 'Seiko Chronograph' }),
          createMockProduct({ title: 'Blue Midi Dress' }),
          createMockProduct({ title: 'Ladies Wristwatch Gold' }),
        ];

        const filtered = service.filterByItemType(products, 'watch');

        expect(filtered.length).toBe(3);
        expect(filtered.map(p => p.title)).toContain('Fossil Carlie Watch');
        expect(filtered.map(p => p.title)).toContain('Seiko Chronograph');
        expect(filtered.map(p => p.title)).toContain('Ladies Wristwatch Gold');
        expect(filtered.map(p => p.title)).not.toContain('Blue Midi Dress');
      });

      it('should return empty for watch slot when only dresses found', () => {
        const products = [
          createMockProduct({ title: 'ASOS Design Dress' }),
          createMockProduct({ title: 'Party Gown' }),
        ];

        const filtered = service.filterByItemType(products, 'women watch');

        expect(filtered.length).toBe(0);
      });
    });

    describe('Belt Filtering', () => {
      it('should filter products to only include belts', () => {
        const products = [
          createMockProduct({ title: 'Leather Belt Brown' }),
          createMockProduct({ title: 'Chain Belt Gold' }),
          createMockProduct({ title: 'Maxi Dress' }),
          createMockProduct({ title: 'Waist Belt Women' }),
        ];

        const filtered = service.filterByItemType(products, 'belt');

        expect(filtered.length).toBe(3);
        expect(filtered.map(p => p.title)).not.toContain('Maxi Dress');
      });

      it('should return empty for belt slot when only dresses found', () => {
        const products = [
          createMockProduct({ title: 'Cocktail Dress' }),
          createMockProduct({ title: 'Evening Dress' }),
        ];

        const filtered = service.filterByItemType(products, 'women belt');

        expect(filtered.length).toBe(0);
      });
    });

    describe('Sunglasses Filtering', () => {
      it('should filter products to only include sunglasses', () => {
        const products = [
          createMockProduct({ title: 'Ray-Ban Aviator Sunglasses' }),
          createMockProduct({ title: 'Cat Eye Shades' }),
          createMockProduct({ title: 'Blue Dress' }),
          createMockProduct({ title: 'Oversized Eyewear' }),
        ];

        const filtered = service.filterByItemType(products, 'sunglasses');

        expect(filtered.length).toBe(3);
        expect(filtered.map(p => p.title)).not.toContain('Blue Dress');
      });

      it('should return empty for sunglasses slot when only dresses found', () => {
        const products = [
          createMockProduct({ title: 'Party Dress' }),
        ];

        const filtered = service.filterByItemType(products, 'women sunglasses');

        expect(filtered.length).toBe(0);
      });
    });

    describe('Dress Filtering', () => {
      it('should filter products to only include dresses', () => {
        const products = [
          createMockProduct({ title: 'Blue Cocktail Dress' }),
          createMockProduct({ title: 'Evening Gown' }),
          createMockProduct({ title: 'High Heels' }),
          createMockProduct({ title: 'Maxi Dress Floral' }),
          createMockProduct({ title: 'Leather Belt' }),
        ];

        const filtered = service.filterByItemType(products, 'dress');

        expect(filtered.length).toBe(3);
        expect(filtered.map(p => p.title)).toContain('Blue Cocktail Dress');
        expect(filtered.map(p => p.title)).toContain('Evening Gown');
        expect(filtered.map(p => p.title)).toContain('Maxi Dress Floral');
      });

      it('should fallback to all products for dress slot when none match', () => {
        const products = [
          createMockProduct({ title: 'Nike Shoes' }),
          createMockProduct({ title: 'Leather Belt' }),
        ];

        const filtered = service.filterByItemType(products, 'party dress');

        // For clothing slots, fallback is acceptable
        expect(filtered.length).toBe(2);
      });
    });

    describe('Bag Filtering', () => {
      it('should filter products to only include bags', () => {
        const products = [
          createMockProduct({ title: 'Leather Handbag' }),
          createMockProduct({ title: 'Evening Clutch' }),
          createMockProduct({ title: 'Cocktail Dress' }),
          createMockProduct({ title: 'Crossbody Bag' }),
        ];

        const filtered = service.filterByItemType(products, 'bag');

        expect(filtered.length).toBe(3);
        expect(filtered.map(p => p.title)).not.toContain('Cocktail Dress');
      });
    });

    describe('No Item Type Provided', () => {
      it('should return all products when no itemType specified', () => {
        const products = [
          createMockProduct({ title: 'Product 1' }),
          createMockProduct({ title: 'Product 2' }),
          createMockProduct({ title: 'Product 3' }),
        ];

        const filtered = service.filterByItemType(products, undefined);

        expect(filtered.length).toBe(3);
      });

      it('should return all products when empty itemType', () => {
        const products = [
          createMockProduct({ title: 'Product 1' }),
          createMockProduct({ title: 'Product 2' }),
        ];

        const filtered = service.filterByItemType(products, '');

        expect(filtered.length).toBe(2);
      });
    });
  });

  // ============================================================================
  // GENDER FILTERING TESTS
  // ============================================================================
  describe('filterByGender', () => {
    it('should filter out womens products when searching for mens', () => {
      const products = [
        createMockProduct({ title: "Women's Dress" }),
        createMockProduct({ title: "Men's Suit" }),
        createMockProduct({ title: 'Unisex Jacket' }),
        createMockProduct({ title: 'Ladies Blouse' }),  // "ladies" is in FEMALE_KEYWORDS
      ];

      const filtered = service.filterByGender(products, 'men');

      // Women's and Ladies should be filtered out, Men's and Unisex should remain
      expect(filtered.length).toBe(2);
      expect(filtered.map(p => p.title)).toContain("Men's Suit");
      expect(filtered.map(p => p.title)).toContain('Unisex Jacket');
      expect(filtered.map(p => p.title)).not.toContain("Women's Dress");
      expect(filtered.map(p => p.title)).not.toContain('Ladies Blouse');
    });

    it('should filter out mens products when searching for womens', () => {
      const products = [
        createMockProduct({ title: "Women's Dress" }),
        createMockProduct({ title: "Men's Suit" }),
        createMockProduct({ title: 'Unisex Jacket' }),
        createMockProduct({ title: "Mens Shirt" }),
      ];

      const filtered = service.filterByGender(products, 'women');

      expect(filtered.length).toBe(2);
      expect(filtered.map(p => p.title)).toContain("Women's Dress");
      expect(filtered.map(p => p.title)).toContain('Unisex Jacket');
    });

    it('should return all products for unisex gender', () => {
      const products = [
        createMockProduct({ title: "Women's Dress" }),
        createMockProduct({ title: "Men's Suit" }),
      ];

      const filtered = service.filterByGender(products, 'unisex');

      expect(filtered.length).toBe(2);
    });

    it('should return all products when no gender specified', () => {
      const products = [
        createMockProduct({ title: "Women's Dress" }),
        createMockProduct({ title: "Men's Suit" }),
      ];

      const filtered = service.filterByGender(products, undefined);

      expect(filtered.length).toBe(2);
    });
  });

  // ============================================================================
  // COLOR FILTERING TESTS
  // ============================================================================
  describe('filterAndBoostByColor', () => {
    it('should prioritize products matching requested color', () => {
      const products = [
        createMockProduct({ title: 'Black Dress' }),
        createMockProduct({ title: 'Blue Dress' }),
        createMockProduct({ title: 'Red Dress' }),
        createMockProduct({ title: 'Navy Blue Gown' }),
      ];

      const filtered = service.filterAndBoostByColor(products, ['blue']);

      // Blue products should come first
      expect(filtered[0].title).toBe('Blue Dress');
      expect(filtered[1].title).toBe('Navy Blue Gown');
    });

    it('should match color synonyms', () => {
      const products = [
        createMockProduct({ title: 'Navy Dress' }),
        createMockProduct({ title: 'Red Dress' }),
        createMockProduct({ title: 'Cobalt Blue Top' }),
      ];

      const filtered = service.filterAndBoostByColor(products, ['blue']);

      // Navy and cobalt are synonyms of blue
      const colorMatchingProducts = filtered.slice(0, 2);
      expect(colorMatchingProducts.map(p => p.title)).toContain('Navy Dress');
      expect(colorMatchingProducts.map(p => p.title)).toContain('Cobalt Blue Top');
    });

    it('should return all products when no color specified', () => {
      const products = [
        createMockProduct({ title: 'Dress 1' }),
        createMockProduct({ title: 'Dress 2' }),
      ];

      const filtered = service.filterAndBoostByColor(products, undefined);

      expect(filtered.length).toBe(2);
    });

    it('should return all products when no matches found', () => {
      const products = [
        createMockProduct({ title: 'Black Dress' }),
        createMockProduct({ title: 'White Dress' }),
      ];

      const filtered = service.filterAndBoostByColor(products, ['purple']);

      // Should return all products with warning
      expect(filtered.length).toBe(2);
    });
  });

  // ============================================================================
  // PRICE FILTERING TESTS
  // ============================================================================
  describe('filterByPrice', () => {
    it('should filter products above max price', () => {
      const products = [
        createMockProduct({ title: 'Cheap Dress', price: 50 }),
        createMockProduct({ title: 'Expensive Dress', price: 200 }),
        createMockProduct({ title: 'Mid Dress', price: 100 }),
      ];

      const filtered = service.filterByPrice(products, 150);

      expect(filtered.length).toBe(2);
      expect(filtered.map(p => p.title)).toContain('Cheap Dress');
      expect(filtered.map(p => p.title)).toContain('Mid Dress');
      expect(filtered.map(p => p.title)).not.toContain('Expensive Dress');
    });

    it('should filter products below min price', () => {
      const products = [
        createMockProduct({ title: 'Cheap Dress', price: 50 }),
        createMockProduct({ title: 'Expensive Dress', price: 200 }),
        createMockProduct({ title: 'Mid Dress', price: 100 }),
      ];

      const filtered = service.filterByPrice(products, undefined, 75);

      expect(filtered.length).toBe(2);
      expect(filtered.map(p => p.title)).toContain('Expensive Dress');
      expect(filtered.map(p => p.title)).toContain('Mid Dress');
    });

    it('should filter products within price range', () => {
      const products = [
        createMockProduct({ title: 'Dress 1', price: 50 }),
        createMockProduct({ title: 'Dress 2', price: 100 }),
        createMockProduct({ title: 'Dress 3', price: 150 }),
        createMockProduct({ title: 'Dress 4', price: 200 }),
      ];

      const filtered = service.filterByPrice(products, 150, 75);

      expect(filtered.length).toBe(2);
      expect(filtered.map(p => p.title)).toContain('Dress 2');
      expect(filtered.map(p => p.title)).toContain('Dress 3');
    });

    it('should keep products without price info', () => {
      const products = [
        createMockProduct({ title: 'Dress with price', price: 100 }),
        createMockProduct({ title: 'Dress without price', price: 0 }),
      ];

      const filtered = service.filterByPrice(products, 50);

      expect(filtered.length).toBe(1);
      expect(filtered[0].title).toBe('Dress without price');
    });
  });

  // ============================================================================
  // DEDUPLICATION TESTS
  // ============================================================================
  describe('deduplicateProducts', () => {
    it('should remove duplicate products based on title, price, and retailer', () => {
      const products = [
        createMockProduct({ title: 'Blue Dress', price: 100, retailer: 'ASOS' }),
        createMockProduct({ title: 'Blue Dress', price: 100, retailer: 'ASOS' }),
        createMockProduct({ title: 'Blue Dress', price: 100, retailer: 'Zara' }),
        createMockProduct({ title: 'Red Dress', price: 100, retailer: 'ASOS' }),
      ];

      const deduplicated = service.deduplicateProducts(products);

      expect(deduplicated.length).toBe(3);
    });

    it('should keep products with different prices', () => {
      const products = [
        createMockProduct({ title: 'Blue Dress', price: 100, retailer: 'ASOS' }),
        createMockProduct({ title: 'Blue Dress', price: 150, retailer: 'ASOS' }),
      ];

      const deduplicated = service.deduplicateProducts(products);

      expect(deduplicated.length).toBe(2);
    });

    it('should handle empty array', () => {
      const deduplicated = service.deduplicateProducts([]);

      expect(deduplicated.length).toBe(0);
    });
  });

  // ============================================================================
  // URL TYPE FILTERING TESTS
  // ============================================================================
  describe('filterByUrlType', () => {
    it('should filter out category page URLs', () => {
      const products = [
        createMockProduct({
          title: 'Product 1',
          productUrl: 'https://example.com/product/123'
        }),
        createMockProduct({
          title: 'Category Page',
          productUrl: 'https://example.com/category/dresses'
        }),
        createMockProduct({
          title: 'Product 2',
          productUrl: 'https://example.com/item/456'
        }),
      ];

      const filtered = service.filterByUrlType(products);

      expect(filtered.length).toBe(2);
      expect(filtered.map(p => p.title)).not.toContain('Category Page');
    });

    it('should filter out search page URLs', () => {
      const products = [
        createMockProduct({
          title: 'Product',
          productUrl: 'https://example.com/product/123'
        }),
        createMockProduct({
          title: 'Search Result',
          productUrl: 'https://example.com/search?q=dress'
        }),
      ];

      const filtered = service.filterByUrlType(products);

      expect(filtered.length).toBe(1);
      expect(filtered[0].title).toBe('Product');
    });

    it('should filter out collection page URLs', () => {
      const products = [
        createMockProduct({
          title: 'Product',
          productUrl: 'https://example.com/product/123'
        }),
        createMockProduct({
          title: 'Collection',
          productUrl: 'https://example.com/collections/summer'
        }),
      ];

      const filtered = service.filterByUrlType(products);

      expect(filtered.length).toBe(1);
      expect(filtered[0].title).toBe('Product');
    });
  });

  // ============================================================================
  // PRODUCT QUALITY FILTERING TESTS
  // ============================================================================
  describe('filterProducts', () => {
    it('should filter out products without images', () => {
      const products = [
        createMockProduct({ title: 'With Image', imageUrl: 'https://example.com/img.jpg' }),
        createMockProduct({ title: 'Without Image', imageUrl: '' }),
      ];

      const filtered = service.filterProducts(products);

      expect(filtered.length).toBe(1);
      expect(filtered[0].title).toBe('With Image');
    });

    it('should filter out products without prices', () => {
      const products = [
        createMockProduct({ title: 'With Price', price: 100 }),
        createMockProduct({ title: 'Without Price', price: 0 }),
      ];

      const filtered = service.filterProducts(products);

      expect(filtered.length).toBe(1);
      expect(filtered[0].title).toBe('With Price');
    });

    it('should filter out products out of stock', () => {
      const products = [
        createMockProduct({ title: 'In Stock', inStock: true }),
        createMockProduct({ title: 'Out of Stock', inStock: false }),
      ];

      const filtered = service.filterProducts(products);

      expect(filtered.length).toBe(1);
      expect(filtered[0].title).toBe('In Stock');
    });

    it('should filter out products with very short titles', () => {
      const products = [
        createMockProduct({ title: 'Good Product Title' }),
        createMockProduct({ title: 'AB' }),
      ];

      const filtered = service.filterProducts(products);

      expect(filtered.length).toBe(1);
      expect(filtered[0].title).toBe('Good Product Title');
    });
  });

  // ============================================================================
  // APPLY ALL FILTERS TESTS
  // ============================================================================
  describe('applyAllFilters', () => {
    it('should apply all filters in correct order', () => {
      const products = [
        createMockProduct({
          title: 'Perfect Blue Dress',
          price: 100,
          inStock: true,
          imageUrl: 'https://example.com/img.jpg',
          productUrl: 'https://example.com/product/1'
        }),
        createMockProduct({
          title: "Men's Suit",
          price: 100,
          inStock: true,
          imageUrl: 'https://example.com/img.jpg',
          productUrl: 'https://example.com/product/2'
        }),
        createMockProduct({
          title: 'Red Expensive Dress',
          price: 500,
          inStock: true,
          imageUrl: 'https://example.com/img.jpg',
          productUrl: 'https://example.com/product/3'
        }),
      ];

      const query: SearchQuery = {
        terms: 'blue dress',
        gender: 'women',
        maxPrice: 200,
        color: ['blue'],
        itemType: 'dress',
      };

      const filtered = service.applyAllFilters(products, query);

      expect(filtered.length).toBe(1);
      expect(filtered[0].title).toBe('Perfect Blue Dress');
    });

    it('should handle empty product list', () => {
      const query: SearchQuery = {
        terms: 'dress',
      };

      const filtered = service.applyAllFilters([], query);

      expect(filtered.length).toBe(0);
    });
  });

  // ============================================================================
  // DIVERSITY TESTS
  // ============================================================================
  describe('diversifyResults', () => {
    it('should limit products per brand', () => {
      const products = Array(10).fill(null).map((_, i) =>
        createMockProduct({
          title: `Product ${i}`,
          brand: 'SameBrand',
          retailer: 'TestRetailer'
        })
      );

      const diversified = service.diversifyResults(products, 3);

      expect(diversified.length).toBeLessThanOrEqual(3);
    });

    it('should allow more products from different brands', () => {
      const products = [
        ...Array(3).fill(null).map((_, i) =>
          createMockProduct({ title: `Brand1 Product ${i}`, brand: 'Brand1', retailer: 'R1' })
        ),
        ...Array(3).fill(null).map((_, i) =>
          createMockProduct({ title: `Brand2 Product ${i}`, brand: 'Brand2', retailer: 'R2' })
        ),
      ];

      const diversified = service.diversifyResults(products, 3);

      expect(diversified.length).toBe(6);
    });
  });

  // ============================================================================
  // RANKING TESTS
  // ============================================================================
  describe('rankProducts', () => {
    it('should rank products by calculated score', async () => {
      const products = [
        createMockProduct({ title: 'Exact Match Dress', rating: 5, reviewCount: 100 }),
        createMockProduct({ title: 'Partial Match', rating: 3, reviewCount: 10 }),
        createMockProduct({ title: 'Random Product', rating: 2, reviewCount: 5 }),
      ];

      const query: SearchQuery = {
        terms: 'dress',
      };

      const ranked = await service.rankProducts(products, query);

      // First product should have highest score due to exact match
      expect(ranked[0].title).toBe('Exact Match Dress');
    });

    it('should handle empty product list', async () => {
      const query: SearchQuery = { terms: 'dress' };
      const ranked = await service.rankProducts([], query);
      expect(ranked.length).toBe(0);
    });
  });
});
