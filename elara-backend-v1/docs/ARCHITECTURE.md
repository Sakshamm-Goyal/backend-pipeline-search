# Elara AI Pipeline - Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT APPLICATIONS                              │
│                    (Mobile App, Web App, Admin Dashboard)                     │
└─────────────────────────────────────────┬───────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                                API GATEWAY                                   │
│                    (Rate Limiting, Auth, Request Routing)                    │
└─────────────────────────────────────────┬───────────────────────────────────┘
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────┐
        │                                 │                                 │
        ▼                                 ▼                                 ▼
┌───────────────────┐         ┌───────────────────┐         ┌───────────────────┐
│   Chat Pipeline   │         │  Wardrobe Module  │         │   Auth Module     │
│                   │         │                   │         │                   │
│ • Chat Controller │         │ • CRUD Operations │         │ • JWT Auth        │
│ • Orchestrator    │         │ • Image Upload    │         │ • OAuth           │
│ • Intent Router   │         │ • AI Analysis     │         │ • Guards          │
│ • Search Agent    │         │                   │         │                   │
│ • Outfit Agent    │         │                   │         │                   │
└─────────┬─────────┘         └─────────┬─────────┘         └───────────────────┘
          │                             │
          │         ┌───────────────────┘
          │         │
          ▼         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SHARED SERVICES LAYER                             │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│   Analytics     │ Personalization │   Embeddings    │    Search             │
│   Service       │    Service      │    Service      │   Orchestrator        │
├─────────────────┼─────────────────┼─────────────────┼───────────────────────┤
│ • Event Tracking│ • User Profiles │ • OpenAI API    │ • Multi-source        │
│ • Aggregations  │ • Reranking     │ • Batch Process │ • Circuit Breaker     │
│ • GDPR Support  │ • Scoring       │ • Similarity    │ • Caching             │
└─────────────────┴─────────────────┴─────────────────┴───────────────────────┘
          │                 │                 │                   │
          ▼                 ▼                 ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           INFRASTRUCTURE LAYER                               │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│     LLM         │     Cache       │    Storage      │    External APIs      │
│   Services      │    Services     │    Services     │                       │
├─────────────────┼─────────────────┼─────────────────┼───────────────────────┤
│ • Claude        │ • Redis         │ • GCS           │ • Oxylabs             │
│ • Gemini        │ • In-Memory     │ • Local         │ • ShopStyle           │
│                 │                 │                 │ • Remove.bg           │
└─────────────────┴─────────────────┴─────────────────┴───────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER                                      │
│                           (MongoDB Atlas)                                    │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│     Users       │   Wardrobe      │    Products     │   Analytics           │
│   Collection    │   Collection    │   Collection    │   Collection          │
├─────────────────┼─────────────────┼─────────────────┼───────────────────────┤
│ • Profile       │ • Items         │ • Cached        │ • User Events         │
│ • Preferences   │ • AI Analysis   │ • Embeddings    │ • Search History      │
│ • OAuth         │ • Embeddings    │ • Prices        │ • Wishlist            │
└─────────────────┴─────────────────┴─────────────────┴───────────────────────┘
```

---

## Module Structure

```
src/modules/pipeline/
├── agents/                      # Chat Agents
│   ├── controllers/
│   │   └── chat.controller.ts
│   ├── services/
│   │   ├── chat-orchestrator.service.ts
│   │   ├── intent-router.service.ts
│   │   ├── search-agent.service.ts
│   │   └── outfit-generator-agent.service.ts
│   ├── domain/
│   │   └── schemas/
│   └── dto/
│
├── search/                      # Search Infrastructure
│   ├── sources/
│   │   ├── oxylabs.service.ts
│   │   └── shopstyle.service.ts
│   ├── scrapers/
│   │   └── asos-scraper.service.ts
│   ├── ranking/
│   │   └── product-ranker.service.ts
│   ├── search-orchestrator.service.ts
│   └── semantic-search.service.ts
│
├── personalization/             # Personalization
│   └── personalization.service.ts
│
├── analytics/                   # Analytics & Tracking
│   ├── analytics.service.ts
│   └── infrastructure/
│       └── persistence/
│
├── wishlist/                    # Wishlist Feature
│   ├── controllers/
│   ├── domain/
│   └── infrastructure/
│
├── search-history/              # Search History
│   ├── controllers/
│   ├── domain/
│   └── infrastructure/
│
├── outfit-scoring/              # Outfit Compatibility
│   ├── controllers/
│   └── outfit-compatibility.service.ts
│
├── embeddings/                  # Vector Embeddings
│   └── embedding.service.ts
│
├── image-processing/            # Image Processing
│   ├── background-removal.service.ts
│   ├── image-processor.service.ts
│   └── wardrobe-embedding-processor.service.ts
│
├── infrastructure/              # Shared Infrastructure
│   ├── llm/
│   │   ├── claude.service.ts
│   │   └── gemini.service.ts
│   ├── cache/
│   │   ├── redis-cache.service.ts
│   │   └── search-cache.service.ts
│   ├── resilience/
│   │   └── circuit-breaker.service.ts
│   └── storage/
│       └── storage.service.ts
│
└── products/                    # Product Catalog
    └── infrastructure/
        └── persistence/
```

---

## Data Flow

### Chat Message Flow

```
User Message
     │
     ▼
┌─────────────────────┐
│  ChatController     │ ─── Validates request, extracts user context
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  ChatOrchestrator   │ ─── Manages conversation state, tracks analytics
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   IntentRouter      │ ─── Uses Claude to classify intent
└──────────┬──────────┘     (search, outfit, feedback, chat, clarification)
           │
     ┌─────┴─────┬─────────────┐
     │           │             │
     ▼           ▼             ▼
┌─────────┐ ┌─────────┐ ┌───────────┐
│ Search  │ │ Outfit  │ │ General   │
│  Agent  │ │  Agent  │ │   Chat    │
└────┬────┘ └────┬────┘ └─────┬─────┘
     │           │             │
     ▼           │             │
┌─────────────┐  │             │
│   Search    │  │             │
│ Orchestrator│  │             │
└──────┬──────┘  │             │
       │         │             │
       ▼         ▼             │
┌─────────────────────┐        │
│  ProductRanker      │        │
│  (Personalization)  │        │
└──────────┬──────────┘        │
           │                   │
           └─────────┬─────────┘
                     │
                     ▼
              Response to User
```

### Search Flow Detail

```
Search Query
     │
     ▼
┌─────────────────────┐
│ QueryBuilder        │ ─── Normalizes query, extracts filters
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ SearchOrchestrator  │
└──────────┬──────────┘
           │
     ┌─────┼─────┬─────────────┐
     │     │     │             │
     ▼     ▼     ▼             ▼
┌───────┐┌───────┐┌───────┐┌───────┐
│Oxylabs││ShopSty││ ASOS  ││ Cache │
│       ││le     ││Scraper││       │
└───┬───┘└───┬───┘└───┬───┘└───┬───┘
    │        │        │        │
    └────────┴────────┴────────┘
                │
                ▼
     ┌─────────────────────┐
     │ Deduplication       │
     └──────────┬──────────┘
                │
                ▼
     ┌─────────────────────┐
     │ Filtering           │ ─── Remove out-of-stock, invalid items
     └──────────┬──────────┘
                │
                ▼
     ┌─────────────────────┐
     │ Personalization     │ ─── Apply user preference boosts
     └──────────┬──────────┘
                │
                ▼
     ┌─────────────────────┐
     │ ML Ranking          │ ─── Score by relevance, quality
     └──────────┬──────────┘
                │
                ▼
     ┌─────────────────────┐
     │ LLM Reranking       │ ─── For close scores (optional)
     └──────────┬──────────┘
                │
                ▼
     ┌─────────────────────┐
     │ Diversification     │ ─── Limit per brand/retailer
     └──────────┬──────────┘
                │
                ▼
          Ranked Results
```

---

## Key Design Patterns

### 1. Circuit Breaker Pattern

Protects against cascade failures from external services.

```typescript
// Each search source has its own circuit breaker
await circuitBreaker.execute(
  'search-oxylabs',
  () => oxylabs.search(query),
  () => [], // Fallback on failure
  {
    timeout: 8000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000
  }
);
```

**States:**
- **Closed**: Normal operation
- **Open**: Failures exceeded threshold, fast-fail
- **Half-Open**: Testing if service recovered

### 2. Multi-Level Caching

```
Request
   │
   ▼
┌─────────────────┐
│ Memory Cache    │ ─── Hot data (5 min TTL)
│ (LRU)           │
└────────┬────────┘
         │ miss
         ▼
┌─────────────────┐
│ Redis Cache     │ ─── Distributed cache (1 hour TTL)
└────────┬────────┘
         │ miss
         ▼
┌─────────────────┐
│ Database        │ ─── Source of truth
└─────────────────┘
```

### 3. Graceful Degradation

Services degrade gracefully when dependencies fail:

| Service Down | Fallback Behavior |
|-------------|-------------------|
| Claude | Use keyword matching for intent |
| Gemini | Skip LLM reranking |
| OpenAI | Skip embedding-based features |
| Redis | Fall back to in-memory cache |
| Oxylabs | Use other search sources |
| All search sources | Return cached results |

### 4. Fire-and-Forget Analytics

Analytics tracking never blocks the main request:

```typescript
// Non-blocking - doesn't await
this.analyticsService.trackSearch(userId, query, results.length);
```

### 5. Optional Dependency Injection

Services use `@Optional()` decorator for graceful handling:

```typescript
constructor(
  private searchOrchestrator: SearchOrchestratorService,
  @Optional() private personalizationService?: PersonalizationService,
) {}

// Use if available
if (this.personalizationService) {
  products = await this.personalizationService.rerank(products);
}
```

---

## Database Schema Overview

### Core Collections

```
users
├── _id: ObjectId
├── email: string
├── profile: {
│   ├── gender: string
│   ├── selectedStyles: string[]
│   ├── likedBrands: string[]
│   ├── priceRange: { min, max }
│   └── preferences: object
├── }
└── timestamps

wardrobe_items
├── _id: ObjectId
├── userId: ObjectId (index)
├── category: enum
├── imageUrl: string
├── aiAnalysis: {
│   ├── dominantColor: string
│   ├── colorPalette: string[]
│   ├── pattern: enum
│   ├── style: string[]
│   └── occasion: string[]
├── }
├── embedding: {
│   ├── vector: number[1536]
│   ├── model: string
│   └── generatedAt: Date
├── }
├── imageProcessing: {
│   ├── status: enum
│   └── processedAt: Date
├── }
└── timestamps

products
├── _id: ObjectId
├── source: string
├── sourceId: string (compound unique with source)
├── title: string
├── price: number
├── embedding: number[1536]
└── timestamps

user_events
├── _id: ObjectId
├── userId: ObjectId (index)
├── eventType: enum
├── eventData: object
├── timestamp: Date (TTL index)
└── context: object

wishlist_items
├── _id: ObjectId
├── userId: ObjectId (index)
├── productId: string
├── savedPrice: number
├── currentPrice: number
├── collectionName: string
└── timestamps

search_history
├── _id: ObjectId
├── userId: ObjectId (index)
├── query: string (text index)
├── resultCount: number
├── interaction: object
└── searchedAt: Date
```

### Indexes

**wardrobe_items:**
- `{ userId: 1, isDeleted: 1, category: 1 }`
- `{ userId: 1, isDeleted: 1, createdAt: -1 }`
- `{ 'embedding.vector': 1 }` (for vector search)

**products:**
- `{ source: 1, sourceId: 1 }` (unique)
- `{ 'embedding.vector': 1 }` (for vector search)

**user_events:**
- `{ userId: 1, eventType: 1, timestamp: -1 }`
- `{ timestamp: 1 }` (TTL: 90 days)

---

## Scalability Considerations

### Current Architecture (MVP)
- Single Node.js instance
- In-memory caching
- MongoDB standard queries

### Production Scaling

1. **Horizontal Scaling**
   - Stateless services behind load balancer
   - Redis for distributed caching & sessions

2. **Database Scaling**
   - MongoDB Atlas with read replicas
   - Vector Search for embeddings
   - Sharding by userId if needed

3. **Background Jobs**
   - Move to dedicated worker instances
   - Use Bull/Redis for job queues
   - Separate concerns (image, embeddings, price tracking)

4. **Search Scaling**
   - Dedicated Elasticsearch for product search
   - Pre-computed embeddings in vector DB
   - CDN for product images

5. **LLM Optimization**
   - Response streaming
   - Batch inference
   - Model caching/warm starts
