# Elara AI Pipeline - Setup & Configuration Guide

This document covers the complete setup for the AI Pipeline infrastructure implemented in Phase 6.5.

## Table of Contents

1. [Environment Configuration](#environment-configuration)
2. [API Endpoints Reference](#api-endpoints-reference)
3. [Background Jobs](#background-jobs)
4. [Service Architecture](#service-architecture)
5. [Testing the Setup](#testing-the-setup)
6. [What's Next](#whats-next)

---

## Environment Configuration

Add the following to your `.env` file:

### Required API Keys

```bash
# LLM Services (at least one required)
ANTHROPIC_API_KEY=your-claude-api-key      # For Claude (intent classification)
GOOGLE_AI_API_KEY=your-gemini-api-key      # For Gemini (reranking, outfit generation)

# Embeddings (required for semantic search & outfit scoring)
OPENAI_API_KEY=your-openai-api-key         # For text-embedding-3-small

# Search APIs (at least one required)
OXYLABS_USERNAME=your-oxylabs-username     # Google Shopping data
OXYLABS_PASSWORD=your-oxylabs-password
SHOPSTYLE_API_KEY=your-shopstyle-api-key   # ShopStyle Collective API
```

### Optional Services

```bash
# Redis (recommended for production caching)
REDIS_URL=redis://localhost:6379

# Image Processing
REMOVEBG_API_KEY=your-removebg-api-key           # Best quality
REPLICATE_API_TOKEN=your-replicate-api-token     # Alternative provider
BG_REMOVAL_PROVIDERS=removebg,replicate          # Priority order
```

### Feature Flags

```bash
# Enable/disable features
ENABLE_OXYLABS=true
ENABLE_SHOPSTYLE=true
ENABLE_PLAYWRIGHT_SCRAPERS=false    # Requires Playwright setup
ENABLE_LLM_RERANK=true
ENABLE_PERSONALIZATION=true
ENABLE_OUTFIT_SCORING=true

# Tuning
PERSONALIZATION_WEIGHT=0.3          # 0.0-1.0, how much to weight user preferences
OUTFIT_SIMILARITY_THRESHOLD=0.5     # Minimum similarity for outfit compatibility
```

### Timeouts & Rate Limits

```bash
SEARCH_TIMEOUT_MS=8000              # Per-source search timeout
LLM_TIMEOUT_MS=30000                # LLM call timeout
OXYLABS_RATE_LIMIT=10               # Requests per second
SHOPSTYLE_RATE_LIMIT=5

# Cache TTL (seconds)
CACHE_SEARCH_TTL=3600               # 1 hour
CACHE_USER_CONTEXT_TTL=300          # 5 minutes
```

---

## API Endpoints Reference

### Chat Pipeline

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/pipeline/chat` | Send chat message |
| GET | `/pipeline/chat/history/:conversationId` | Get conversation history |
| DELETE | `/pipeline/chat/:conversationId` | Delete conversation |

**Chat Request Example:**
```json
POST /pipeline/chat
{
  "message": "Find me a red dress for a wedding",
  "conversationId": "optional-existing-id"
}
```

### Wishlist

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/pipeline/wishlist` | Get user's wishlist |
| GET | `/pipeline/wishlist/stats` | Get wishlist statistics |
| GET | `/pipeline/wishlist/collections` | Get user's collections |
| GET | `/pipeline/wishlist/price-drops` | Get items with price drops |
| GET | `/pipeline/wishlist/check/:productId` | Check if saved |
| POST | `/pipeline/wishlist` | Add to wishlist |
| DELETE | `/pipeline/wishlist/:productId` | Remove from wishlist |
| PATCH | `/pipeline/wishlist/:productId/collection` | Move to collection |
| PATCH | `/pipeline/wishlist/:productId/notes` | Update notes |
| PATCH | `/pipeline/wishlist/:productId/alert` | Set price alert |
| PATCH | `/pipeline/wishlist/:productId/purchased` | Mark as purchased |

**Add to Wishlist Example:**
```json
POST /pipeline/wishlist
{
  "productId": "prod_123",
  "productTitle": "Red Maxi Dress",
  "productBrand": "Zara",
  "productImageUrl": "https://...",
  "productUrl": "https://...",
  "savedPrice": 89.99,
  "collectionName": "Wedding Outfits"
}
```

### Search History

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/pipeline/search-history` | Get recent searches | User |
| GET | `/pipeline/search-history/suggestions` | Autocomplete | User |
| GET | `/pipeline/search-history/analytics` | User analytics | User |
| GET | `/pipeline/search-history/trending` | Trending searches | Admin |
| GET | `/pipeline/search-history/global-analytics` | Global stats | Admin |
| POST | `/pipeline/search-history` | Save search | User |
| POST | `/pipeline/search-history/:id/interaction` | Update interaction | User |
| DELETE | `/pipeline/search-history/:id` | Delete search | User |
| DELETE | `/pipeline/search-history` | Clear all | User |

### Outfit Scoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/pipeline/outfit-scoring/score` | Score outfit compatibility |
| POST | `/pipeline/outfit-scoring/suggestions` | Get completion suggestions |
| POST | `/pipeline/outfit-scoring/best-matches` | Find best matching items |
| GET | `/pipeline/outfit-scoring/weights` | Get scoring weights info |

**Score Outfit Example:**
```json
POST /pipeline/outfit-scoring/score
{
  "items": [
    {
      "id": "item_1",
      "category": "top",
      "dominantColor": "#FFFFFF",
      "pattern": "solid",
      "style": ["casual", "minimalist"]
    },
    {
      "id": "item_2",
      "category": "bottom",
      "dominantColor": "#000080",
      "pattern": "solid",
      "style": ["casual"]
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "score": 0.82,
    "components": {
      "colorHarmony": 0.9,
      "patternBalance": 1.0,
      "categoryCompleteness": 0.8,
      "styleCohesion": 0.85
    },
    "issues": [],
    "suggestions": ["Add accessories to complete the look"],
    "interpretation": {
      "rating": "Good",
      "emoji": "👍",
      "message": "Solid outfit choice with good coordination."
    }
  }
}
```

---

## Background Jobs

The pipeline includes several scheduled background jobs:

### 1. Image Processing (Every 2 minutes)
- **File:** `image-processor.service.ts`
- **Purpose:** Process wardrobe images (background removal, thumbnails)
- **Cron:** `*/2 * * * *`

### 2. Embedding Generation (Every 5 minutes)
- **File:** `wardrobe-embedding-processor.service.ts`
- **Purpose:** Generate vector embeddings for wardrobe items
- **Cron:** `*/5 * * * *`

### Requirements
- `ScheduleModule.forRoot()` must be imported in `app.module.ts` (already configured)
- OpenAI API key required for embeddings
- Background removal API key(s) required for image processing

---

## Service Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Chat Controller                          │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│              ChatOrchestratorService                         │
│  • Manages conversation context                              │
│  • Routes to appropriate agent                               │
│  • Tracks analytics                                          │
└─────────────────────────┬───────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
┌────────▼───────┐ ┌──────▼──────┐ ┌───────▼───────┐
│ IntentRouter   │ │ SearchAgent │ │ OutfitAgent   │
│ (Claude LLM)   │ │             │ │ (Gemini LLM)  │
└────────────────┘ └──────┬──────┘ └───────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│           SearchOrchestratorService                          │
│  • Multi-source parallel search                              │
│  • Circuit breaker protection                                │
│  • Caching (Redis/in-memory)                                 │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│              ProductRankerService                            │
│  • PersonalizationService integration                        │
│  • ML-based scoring                                          │
│  • LLM reranking for close scores                            │
└─────────────────────────────────────────────────────────────┘
```

### Key Services

| Service | Purpose |
|---------|---------|
| `ChatOrchestratorService` | Main coordinator for all chat interactions |
| `IntentRouterService` | Classifies user intent using Claude |
| `SearchAgentService` | Handles product search requests |
| `OutfitGeneratorAgentService` | Creates outfit combinations |
| `SearchOrchestratorService` | Coordinates multi-source search |
| `ProductRankerService` | Ranks products with personalization |
| `PersonalizationService` | Computes personalized rankings |
| `AnalyticsService` | Tracks user behavior (non-blocking) |
| `OutfitCompatibilityService` | Scores outfit combinations |
| `EmbeddingService` | Generates vector embeddings |
| `WardrobeEmbeddingProcessorService` | Background embedding jobs |

---

## Testing the Setup

### 1. Verify Build
```bash
cd Elara-Backend-v1/elara-backend-v1
npm run build
```

### 2. Start Development Server
```bash
npm run start:dev
```

### 3. Test Chat Endpoint
```bash
curl -X POST http://localhost:3000/pipeline/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"message": "Find me a blue dress"}'
```

### 4. Test Outfit Scoring
```bash
curl -X POST http://localhost:3000/pipeline/outfit-scoring/score \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "items": [
      {"id": "1", "category": "top", "dominantColor": "#FFFFFF"},
      {"id": "2", "category": "bottom", "dominantColor": "#000000"}
    ]
  }'
```

### 5. Check Health
```bash
curl http://localhost:3000/health
```

---

## What's Next

### Recommended Next Steps (Priority Order)

#### 1. **Integration Testing** (High Priority)
- Write E2E tests for chat flow
- Test search with real API keys
- Verify analytics tracking

#### 2. **MongoDB Atlas Vector Search** (High Priority)
- Upgrade from in-memory cosine similarity to Atlas Vector Search
- Enables sub-second similarity queries at scale
- Required for production outfit recommendations

#### 3. **Price Tracking Job** (Medium Priority)
- Implement scheduled job to check wishlist price changes
- Send notifications for price drops
- Update `currentPrice` field on wishlist items

#### 4. **Outfit History & Recommendations** (Medium Priority)
- Track outfit combinations users create/save
- Use history to improve recommendations
- Implement "Wear this again" suggestions

#### 5. **Search Source Expansion** (Lower Priority)
- Add more retailer scrapers (H&M, Mango, etc.)
- Implement affiliate link generation
- Add product availability checking

#### 6. **Advanced Personalization** (Lower Priority)
- Implement collaborative filtering
- Add seasonal trend awareness
- Personal color analysis integration

#### 7. **Performance Optimization** (Ongoing)
- Implement response streaming for chat
- Add CDN for processed images
- Optimize embedding batch sizes

### Production Checklist

- [ ] All API keys configured in production environment
- [ ] Redis configured for caching
- [ ] MongoDB Atlas with Vector Search enabled
- [ ] Rate limiting configured per environment
- [ ] Error monitoring (Sentry, etc.) set up
- [ ] Logging configured for production
- [ ] Health checks integrated with monitoring
- [ ] Background job monitoring
- [ ] API documentation (Swagger) generated

---

## Troubleshooting

### Common Issues

**1. "Embedding service not available"**
- Ensure `OPENAI_API_KEY` is set
- Check API key has embedding permissions

**2. "Search returned no results"**
- Verify search API keys (Oxylabs/ShopStyle)
- Check feature flags are enabled
- Review circuit breaker logs

**3. "Personalization not working"**
- Ensure `ENABLE_PERSONALIZATION=true`
- User must have interaction history
- Check AnalyticsModule is imported

**4. "Background jobs not running"**
- Verify `ScheduleModule.forRoot()` in app.module.ts
- Check logs for cron execution
- Ensure required services are available

---

*Last updated: Phase 6.5 completion*
