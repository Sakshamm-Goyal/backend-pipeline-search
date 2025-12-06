import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Chat API E2E Tests', () => {
  let app: INestApplication;
  let authToken: string;
  let userId: string;
  let conversationId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply same validation pipe as main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Authentication Flow', () => {
    it('should register a new user', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: `test-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          firstName: 'Test',
          lastName: 'User',
        })
        .expect(201);

      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('user');
      authToken = response.body.accessToken;
      userId = response.body.user._id;
    });

    it('should reject chat requests without authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .send({
          message: 'Show me dresses',
        })
        .expect(401);
    });

    it('should allow health check without authentication', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/chat/health')
        .expect(200);
    });
  });

  describe('Chat Message Flow', () => {
    it('should send first message and create conversation', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'I need a dress for a wedding',
          userContext: {
            gender: 'female',
            style: 'elegant',
          },
        })
        .expect(200);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('response');
      expect(response.body.response).toHaveProperty('message');
      expect(response.body.response).toHaveProperty('type');
      expect(response.body).toHaveProperty('conversationContext');
      expect(response.body.conversationContext).toHaveProperty('conversationId');

      conversationId = response.body.conversationContext.conversationId;
      expect(conversationId).toBeDefined();
    });

    it('should continue conversation with context', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Show me something in navy blue',
          conversationId,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.conversationContext.conversationId).toBe(conversationId);
      expect(response.body.conversationContext.history.length).toBeGreaterThan(2);
    });

    it('should maintain conversation history', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'What about price range under $200?',
          conversationId,
        })
        .expect(200);

      const history = response.body.conversationContext.history;
      expect(history.length).toBeGreaterThanOrEqual(4);
      expect(history.some((msg: any) => msg.role === 'user')).toBe(true);
      expect(history.some((msg: any) => msg.role === 'assistant')).toBe(true);
    });

    it('should validate message is required', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: '',
        })
        .expect(400);
    });

    it('should reject invalid conversationId format', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Show me dresses',
          conversationId: 'invalid-uuid',
        })
        .expect(400);
    });
  });

  describe('Product Search Intent', () => {
    it('should handle product search requests', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Show me red dresses under $150',
          userContext: {
            gender: 'female',
          },
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.response.type).toBe('product_list');
      expect(response.body.response).toHaveProperty('data');
      expect(response.body.response.data).toHaveProperty('products');
    });

    it('should handle specific category searches', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Find black leather jackets for men',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.response.type).toBe('product_list');
    });

    it('should handle brand-specific searches', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Nike running shoes',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Outfit Generation Intent', () => {
    it('should handle outfit generation requests', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Create a professional outfit for a job interview',
          userContext: {
            gender: 'female',
            style: 'professional',
          },
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.response.type).toBe('outfit_recommendations');
      expect(response.body.response.data).toHaveProperty('outfits');
      expect(Array.isArray(response.body.response.data.outfits)).toBe(true);
    });

    it('should handle occasion-based outfit requests', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'What should I wear to a beach wedding?',
          userContext: {
            gender: 'male',
          },
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(['outfit_recommendations', 'product_list']).toContain(
        response.body.response.type,
      );
    });
  });

  describe('Clarification Flow', () => {
    it('should request clarification for vague queries', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'I need clothes',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      // Should either provide clarification or make best guess
      expect(response.body.response).toHaveProperty('message');
    });
  });

  describe('Greeting and Help Intent', () => {
    it('should handle greeting messages', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Hello',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.response.type).toBe('text');
      expect(response.body.response.message).toBeDefined();
    });

    it('should handle help requests', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'What can you do?',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.response.message).toBeDefined();
    });
  });

  describe('Conversation Management', () => {
    it('should create new conversation explicitly', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          userId: userId,
        })
        .expect(201);

      expect(response.body).toHaveProperty('conversation');
      expect(response.body.conversation).toHaveProperty('conversationId');
      expect(response.body.conversation).toHaveProperty('userId');
      expect(response.body.conversation.history).toEqual([]);
    });

    it('should list user conversations', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/chat/conversations')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('conversations');
      expect(response.body).toHaveProperty('pagination');
      expect(Array.isArray(response.body.conversations)).toBe(true);
    });

    it('should delete conversation', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/chat/conversations/${conversationId}/delete`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('deleted');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .set('Content-Type', 'application/json')
        .send('invalid-json')
        .expect(400);
    });

    it('should reject requests with unknown fields', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Show me dresses',
          unknownField: 'should be rejected',
        })
        .expect(400);
    });

    it('should handle extremely long messages', async () => {
      const longMessage = 'a'.repeat(10000);

      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: longMessage,
        });

      // Should either accept (with truncation) or reject gracefully
      expect([200, 400]).toContain(response.status);
    });
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/chat/health')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('components');
      expect(response.body.components).toHaveProperty('chatOrchestrator');
      expect(response.body.components).toHaveProperty('intentRouter');
      expect(response.body.components).toHaveProperty('searchAgent');
      expect(response.body.components).toHaveProperty('outfitGenerator');
    });
  });

  describe('Performance', () => {
    it('should respond to simple chat within reasonable time', async () => {
      const startTime = Date.now();

      await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Hello',
        })
        .expect(200);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(5000); // 5 seconds max for greeting
    });

    it('should handle concurrent requests', async () => {
      const requests = Array.from({ length: 5 }, (_, i) =>
        request(app.getHttpServer())
          .post('/api/v1/chat/message')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            message: `Show me dress ${i}`,
          }),
      );

      const responses = await Promise.all(requests);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });
  });

  describe('User Context Persistence', () => {
    it('should maintain user context across messages in same conversation', async () => {
      // First message with context
      const response1 = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Show me dresses',
          userContext: {
            gender: 'female',
            sizes: { dress: '8' },
          },
        })
        .expect(200);

      const newConversationId = response1.body.conversationContext.conversationId;

      // Second message without explicit context (should use conversation context)
      const response2 = await request(app.getHttpServer())
        .post('/api/v1/chat/message')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          message: 'Show me in red',
          conversationId: newConversationId,
        })
        .expect(200);

      expect(response2.body.success).toBe(true);
      expect(response2.body.conversationContext.conversationId).toBe(newConversationId);
    });
  });
});
