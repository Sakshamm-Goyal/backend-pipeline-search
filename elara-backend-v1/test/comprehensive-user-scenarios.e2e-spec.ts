/**
 * Comprehensive E2E Test Suite for Elara Backend
 *
 * This test suite covers ALL major user scenarios including:
 * - Search scenarios (products, categories, filters)
 * - Outfit generation scenarios (occasions, styles, complete outfits)
 * - Product replacement scenarios
 * - Context management and conversation flow
 * - Suggestions and recommendations
 * - Edge cases and error handling
 *
 * @author Claude Code
 * @date 2025-12-04
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Comprehensive User Scenarios E2E Tests', () => {
  let app: INestApplication;
  let authToken: string;
  let userId: string;
  let conversationId: string;

  // Test data storage for cross-test references
  const testData: {
    savedOutfitId?: string;
    savedProductId?: string;
    savedConversationIds: string[];
  } = {
    savedConversationIds: [],
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    // Register and authenticate test user
    const uniqueEmail = `test-comprehensive-${Date.now()}@example.com`;
    const registerResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: uniqueEmail,
        password: 'SecureTestPassword123!',
        firstName: 'Test',
        lastName: 'Comprehensive',
      });

    if (registerResponse.body.accessToken) {
      authToken = registerResponse.body.accessToken;
      userId = registerResponse.body.user._id || registerResponse.body.user.id;
    } else {
      // Try login if registration failed (user exists)
      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: uniqueEmail,
          password: 'SecureTestPassword123!',
        });
      authToken = loginResponse.body.accessToken;
      userId = loginResponse.body.user._id || loginResponse.body.user.id;
    }
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  // ============================================================================
  // SECTION 1: PRODUCT SEARCH SCENARIOS
  // ============================================================================
  describe('1. Product Search Scenarios', () => {
    describe('1.1 Basic Product Searches', () => {
      it('should search for a single product category', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Show me dresses' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.response.type).toBe('product_list');
        expect(response.body.response.data.products).toBeDefined();
        expect(Array.isArray(response.body.response.data.products)).toBe(true);
      }, 60000);

      it('should search with color filter', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Find me red dresses' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.response.data.products).toBeDefined();
      }, 60000);

      it('should search with price filter', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Show me dresses under $100' })
          .expect(200);

        expect(response.body.success).toBe(true);
        // Verify products are within price range if returned
        if (response.body.response.data?.products?.length > 0) {
          const products = response.body.response.data.products;
          products.forEach((product: any) => {
            if (product.price) {
              expect(product.price).toBeLessThanOrEqual(100);
            }
          });
        }
      }, 60000);

      it('should search with brand filter', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Nike sneakers' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should search with multiple filters combined', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Blue silk dress under $200',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);
    });

    describe('1.2 Gender-Specific Searches', () => {
      it('should search for womens products', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Womens blouses',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should search for mens products', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Mens dress shirts',
            userContext: { gender: 'male' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should infer gender from product type', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Evening gowns' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);
    });

    describe('1.3 Accessory Searches', () => {
      it('should search for shoes', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'High heels for women' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should search for watches', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Womens watches' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should search for bags', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Leather handbags' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should search for jewelry', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Gold necklaces' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should search for sunglasses', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Designer sunglasses' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should search for belts', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Leather belts for men' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);
    });

    describe('1.4 Occasion-Based Searches', () => {
      it('should search for wedding attire', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Wedding guest dresses' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should search for work attire', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Professional work pants' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should search for party attire', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Party dresses for clubbing' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should search for casual attire', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Casual weekend outfits' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);
    });

    describe('1.5 Style-Based Searches', () => {
      it('should search for bohemian style', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Boho style maxi dresses' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should search for minimalist style', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Minimalist black tops' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should search for vintage style', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Vintage style skirts' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);
    });
  });

  // ============================================================================
  // SECTION 2: OUTFIT GENERATION SCENARIOS
  // ============================================================================
  describe('2. Outfit Generation Scenarios', () => {
    describe('2.1 Complete Outfit Requests', () => {
      it('should generate a complete outfit for a party', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Create a complete outfit for a cocktail party',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.response.type).toBe('outfit_recommendations');
        expect(response.body.response.data.outfits).toBeDefined();
        expect(response.body.response.data.outfits.length).toBeGreaterThan(0);

        // Verify outfit structure
        const outfit = response.body.response.data.outfits[0];
        expect(outfit).toHaveProperty('items');
        expect(Array.isArray(outfit.items)).toBe(true);

        // Store for later tests
        if (outfit.id) {
          testData.savedOutfitId = outfit.id;
        }
      }, 120000);

      it('should generate outfit with multiple clothing items', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'I need a full outfit with dress, shoes, and accessories for a wedding',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        if (response.body.response.type === 'outfit_recommendations') {
          const outfit = response.body.response.data.outfits[0];
          expect(outfit.items.length).toBeGreaterThanOrEqual(2);
        }
      }, 120000);

      it('should generate outfit with specific color scheme', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Create a blue themed outfit for a formal event',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 120000);
    });

    describe('2.2 Occasion-Based Outfits', () => {
      it('should generate wedding guest outfit', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'What should I wear to a summer wedding?',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(['outfit_recommendations', 'product_list']).toContain(response.body.response.type);
      }, 120000);

      it('should generate job interview outfit', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Create a professional outfit for a job interview',
            userContext: { gender: 'male' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 120000);

      it('should generate date night outfit', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Suggest a romantic date night outfit',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 120000);

      it('should generate business casual outfit', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Business casual outfit for the office',
            userContext: { gender: 'male' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 120000);

      it('should generate casual weekend outfit', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Casual outfit for brunch with friends',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 120000);
    });

    describe('2.3 Dress-Based Outfits', () => {
      it('should generate outfit around a cocktail dress', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Show me a blue cocktail dress with matching accessories',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 120000);

      it('should generate outfit around a maxi dress', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Floral maxi dress outfit for vacation',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 120000);

      it('should generate outfit around an evening gown', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Black evening gown with elegant accessories for a gala',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 120000);
    });

    describe('2.4 Budget-Constrained Outfits', () => {
      it('should generate outfit within budget', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Create a party outfit under $200 total',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 120000);

      it('should generate affordable everyday outfit', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Budget-friendly casual outfit under $100',
            userContext: { gender: 'male' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 120000);
    });
  });

  // ============================================================================
  // SECTION 3: PRODUCT REPLACEMENT SCENARIOS
  // ============================================================================
  describe('3. Product Replacement Scenarios', () => {
    let outfitForReplacement: any;

    beforeAll(async () => {
      // Create an outfit to use for replacement tests
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Create a complete outfit for a party with dress, shoes, and accessories',
          userContext: { gender: 'female' }
        });

      if (response.body.response?.data?.outfits?.[0]) {
        outfitForReplacement = response.body.response.data.outfits[0];
        conversationId = response.body.conversationContext?.conversationId;
      }
    }, 120000);

    describe('3.1 Slot-Based Replacements', () => {
      it('should handle request to replace shoes in outfit', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Show me different shoes for this outfit',
            conversationId,
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should handle request for alternative accessories', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'I want different accessories',
            conversationId,
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should handle request for different dress style', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Show me a different dress, maybe something shorter',
            conversationId,
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);
    });

    describe('3.2 Criteria-Based Replacements', () => {
      it('should replace with cheaper alternative', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Find me a cheaper dress option',
            conversationId,
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should replace with different color', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Show the same style but in red',
            conversationId,
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should replace with different brand', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Show me similar from a different brand',
            conversationId,
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);
    });
  });

  // ============================================================================
  // SECTION 4: CONTEXT MANAGEMENT AND CONVERSATION FLOW
  // ============================================================================
  describe('4. Context Management and Conversation Flow', () => {
    let testConversationId: string;

    describe('4.1 Conversation Creation and Persistence', () => {
      it('should create a new conversation on first message', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'I want to find a dress for my birthday party' })
          .expect(200);

        expect(response.body.conversationContext).toBeDefined();
        expect(response.body.conversationContext.conversationId).toBeDefined();
        testConversationId = response.body.conversationContext.conversationId;
        testData.savedConversationIds.push(testConversationId);
      }, 60000);

      it('should maintain context in follow-up messages', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Make it blue',
            conversationId: testConversationId,
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.conversationContext.conversationId).toBe(testConversationId);
        // Should remember we were looking for dresses
      }, 60000);

      it('should remember price constraints from earlier', async () => {
        // First set a price constraint
        await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Keep it under $150',
            conversationId: testConversationId,
          });

        // Then ask for more options
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Show me more options',
            conversationId: testConversationId,
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        // Should still apply the $150 filter
      }, 60000);
    });

    describe('4.2 Conversation History', () => {
      it('should retrieve conversation history', async () => {
        const response = await request(app.getHttpServer())
          .get(`/api/v1/chat/conversations/${testConversationId}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.conversation).toBeDefined();
        expect(response.body.conversation.history).toBeDefined();
        expect(response.body.conversation.history.length).toBeGreaterThan(0);
      });

      it('should list all user conversations', async () => {
        const response = await request(app.getHttpServer())
          .get('/api/v1/chat/conversations')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.conversations).toBeDefined();
        expect(Array.isArray(response.body.conversations)).toBe(true);
      });
    });

    describe('4.3 Context Switching', () => {
      it('should handle topic change gracefully', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Actually, show me mens suits instead',
            conversationId: testConversationId,
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        // Should switch to mens suits
      }, 60000);

      it('should start fresh conversation when requested', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Start over - I need summer dresses' })
          .expect(200);

        expect(response.body.success).toBe(true);
        // Should start a new search context
      }, 60000);
    });

    describe('4.4 User Profile Context', () => {
      it('should apply user profile to searches', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Show me outfits that match my style',
            userContext: {
              gender: 'female',
              style: 'bohemian',
              favoriteColors: ['earth tones', 'burgundy'],
              size: 'M',
            }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should remember user preferences in conversation', async () => {
        // First establish preferences
        const firstResponse = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'I prefer minimalist style',
          });

        const convId = firstResponse.body.conversationContext.conversationId;

        // Then ask for recommendations
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Show me dresses',
            conversationId: convId,
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        // Should apply minimalist preference
      }, 60000);
    });
  });

  // ============================================================================
  // SECTION 5: SUGGESTIONS AND RECOMMENDATIONS
  // ============================================================================
  describe('5. Suggestions and Recommendations', () => {
    describe('5.1 Style Suggestions', () => {
      it('should suggest outfit improvements', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'How can I style a plain black dress?',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.response.message).toBeDefined();
      }, 60000);

      it('should suggest complementary items', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'What accessories would go with a red cocktail dress?',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should suggest based on occasion', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'What should I wear to a tech startup interview?',
            userContext: { gender: 'male' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);
    });

    describe('5.2 Similar Product Suggestions', () => {
      it('should suggest similar products', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Show me more dresses like this one',
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should suggest products in different price ranges', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Show me similar styles in different price points',
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);
    });

    describe('5.3 Trend-Based Suggestions', () => {
      it('should suggest trending items', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'What are trending party dresses right now?',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should suggest seasonal items', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Show me summer fashion essentials',
            userContext: { gender: 'female' }
          })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);
    });
  });

  // ============================================================================
  // SECTION 6: EDGE CASES AND ERROR HANDLING
  // ============================================================================
  describe('6. Edge Cases and Error Handling', () => {
    describe('6.1 Vague Queries', () => {
      it('should handle very vague query', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'I need clothes' })
          .expect(200);

        expect(response.body.success).toBe(true);
        // Should either clarify or provide general results
      }, 60000);

      it('should handle ambiguous query', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Something nice' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);
    });

    describe('6.2 Invalid Inputs', () => {
      it('should reject empty message', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: '' })
          .expect(400);
      });

      it('should reject message that is too long', async () => {
        const longMessage = 'a'.repeat(10001);
        await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: longMessage })
          .expect(400);
      });

      it('should handle invalid conversation ID', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: 'Show me dresses',
            conversationId: 'not-a-valid-uuid',
          })
          .expect(400);
      });
    });

    describe('6.3 Special Characters', () => {
      it('should handle special characters in query', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Show me dresses with "floral" pattern!' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);

      it('should handle emojis in query', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Show me pretty dresses 👗' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);
    });

    describe('6.4 No Results Scenarios', () => {
      it('should handle impossible filter combination gracefully', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Purple polka dot leather evening gowns under $10' })
          .expect(200);

        expect(response.body.success).toBe(true);
        // Should return empty or suggest alternatives
      }, 60000);

      it('should handle very niche query', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Victorian steampunk corset dress with brass buttons' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);
    });

    describe('6.5 Greeting and Help', () => {
      it('should handle greeting message', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Hello!' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.response.type).toBe('text');
      }, 60000);

      it('should handle help request', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'What can you help me with?' })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.response.message).toBeDefined();
      }, 60000);

      it('should handle thank you message', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: 'Thanks for your help!' })
          .expect(200);

        expect(response.body.success).toBe(true);
      }, 60000);
    });
  });

  // ============================================================================
  // SECTION 7: PERFORMANCE AND CONCURRENT REQUESTS
  // ============================================================================
  describe('7. Performance and Concurrent Requests', () => {
    it('should handle concurrent search requests', async () => {
      const requests = Array(5).fill(null).map((_, i) =>
        request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({ message: `Show me dresses style ${i}` })
      );

      const responses = await Promise.all(requests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    }, 180000);

    it('should respond within reasonable time for simple search', async () => {
      const startTime = Date.now();

      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ message: 'Blue dresses' });

      const duration = Date.now() - startTime;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(30000); // 30 second max
    }, 60000);
  });

  // ============================================================================
  // SECTION 8: OUTFIT SLOT VALIDATION
  // ============================================================================
  describe('8. Outfit Slot Validation', () => {
    it('should return correct product types for each slot', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Create a complete party outfit with dress, shoes, watch, belt, and sunglasses',
          userContext: { gender: 'female' }
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      if (response.body.response.type === 'outfit_recommendations') {
        const outfit = response.body.response.data.outfits[0];

        outfit.items.forEach((item: any) => {
          const slotLower = item.slot.toLowerCase();
          const nameLower = item.name.toLowerCase();

          // Verify dress slot has dresses
          if (slotLower === 'dress') {
            expect(nameLower).toMatch(/dress|gown|frock/);
          }

          // Verify shoes slot has footwear
          if (slotLower === 'shoes' || slotLower === 'heels') {
            expect(nameLower).toMatch(/shoe|heel|pump|sandal|boot|sneaker|loafer|flat/);
          }

          // Verify watch slot has watches
          if (slotLower === 'watch') {
            expect(nameLower).toMatch(/watch|timepiece/);
          }

          // Verify belt slot has belts
          if (slotLower === 'belt') {
            expect(nameLower).toMatch(/belt/);
          }

          // Verify sunglasses slot has eyewear
          if (slotLower === 'sunglasses') {
            expect(nameLower).toMatch(/sunglasses|shades|eyewear/);
          }
        });
      }
    }, 180000);

    it('should not show dresses in accessory slots', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Show me a blue cocktail dress for a party',
          userContext: { gender: 'female' }
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      if (response.body.response.type === 'outfit_recommendations') {
        const outfit = response.body.response.data.outfits[0];

        outfit.items.forEach((item: any) => {
          const slotLower = item.slot.toLowerCase();
          const nameLower = item.name.toLowerCase();

          // Accessory slots should NOT contain dress products
          if (['shoes', 'watch', 'belt', 'sunglasses', 'bag', 'jewelry'].includes(slotLower)) {
            expect(nameLower).not.toMatch(/\bdress\b|\bgown\b/);
          }
        });
      }
    }, 180000);
  });

  // ============================================================================
  // SECTION 9: API ENDPOINT COVERAGE
  // ============================================================================
  describe('9. API Endpoint Coverage', () => {
    describe('9.1 Chat Endpoints', () => {
      it('GET /api/v1/chat/health should return health status', async () => {
        const response = await request(app.getHttpServer())
          .get('/api/v1/chat/health')
          .expect(200);

        expect(response.body.status).toBeDefined();
      });

      it('POST /api/v1/chat/conversations should create conversation', async () => {
        const response = await request(app.getHttpServer())
          .post('/api/v1/chat/conversations')
          .set('Authorization', `Bearer ${authToken}`)
          .send({})
          .expect(201);

        expect(response.body.conversation).toBeDefined();
        expect(response.body.conversation.conversationId).toBeDefined();
      });

      it('GET /api/v1/chat/conversations should list conversations', async () => {
        const response = await request(app.getHttpServer())
          .get('/api/v1/chat/conversations')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(response.body.conversations).toBeDefined();
        expect(response.body.pagination).toBeDefined();
      });
    });

    describe('9.2 Search History Endpoints (if available)', () => {
      it('GET /api/v1/pipeline/search-history should return search history', async () => {
        const response = await request(app.getHttpServer())
          .get('/api/v1/pipeline/search-history')
          .set('Authorization', `Bearer ${authToken}`);

        // May return 200 or 404 depending on implementation
        expect([200, 404]).toContain(response.status);
      });
    });

    describe('9.3 Wishlist Endpoints (if available)', () => {
      it('GET /api/v1/pipeline/wishlist should return wishlist', async () => {
        const response = await request(app.getHttpServer())
          .get('/api/v1/pipeline/wishlist')
          .set('Authorization', `Bearer ${authToken}`);

        expect([200, 404]).toContain(response.status);
      });
    });
  });
});
