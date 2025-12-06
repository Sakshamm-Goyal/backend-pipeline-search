# Elara AI Pipeline - API Reference

Complete API documentation for all pipeline endpoints.

---

## Authentication

All endpoints require JWT authentication unless marked as public.

```
Authorization: Bearer <jwt_token>
```

---

## Chat API

### Send Message

Send a message to the AI chat assistant.

```
POST /pipeline/chat
```

**Request Body:**
```json
{
  "message": "string (required)",
  "conversationId": "string (optional - for continuing conversation)"
}
```

**Response:**
```json
{
  "success": true,
  "response": {
    "message": "string",
    "type": "text | product_list | outfit | clarification | error",
    "data": {
      "products": [...],      // For product_list type
      "outfits": [...],       // For outfit type
      "totalFound": 100
    },
    "suggestedActions": [
      {
        "label": "Refine search",
        "action": "refine_search"
      }
    ],
    "metadata": {
      "intent": "search_product",
      "confidence": 0.95,
      "agentUsed": "search",
      "processingTime": 1234
    }
  },
  "conversationContext": {
    "conversationId": "uuid",
    "userId": "string",
    "sessionId": "uuid",
    "history": [...],
    "currentIntent": "string"
  }
}
```

**Response Types:**
- `text` - Plain text response
- `product_list` - Products with search results
- `outfit` - Outfit recommendations
- `clarification` - Asking for more details
- `error` - Error occurred

---

## Wishlist API

### Get Wishlist

```
GET /pipeline/wishlist
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| collectionName | string | - | Filter by collection |
| page | number | 1 | Page number |
| limit | number | 20 | Items per page |
| sortBy | string | createdAt | Sort field |
| sortOrder | asc/desc | desc | Sort direction |
| includePurchased | boolean | false | Include purchased items |

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "string",
        "userId": "string",
        "productId": "string",
        "productTitle": "Red Maxi Dress",
        "productBrand": "Zara",
        "productImageUrl": "https://...",
        "productUrl": "https://...",
        "savedPrice": 89.99,
        "currentPrice": 79.99,
        "priceDropPercent": 11.1,
        "collectionName": "Wedding",
        "createdAt": "2024-01-15T..."
      }
    ],
    "total": 45,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

### Get Wishlist Stats

```
GET /pipeline/wishlist/stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalItems": 45,
    "totalValue": 2450.00,
    "itemsByCollection": {
      "Wedding": 12,
      "Casual": 20,
      "uncategorized": 13
    },
    "priceDrops": 5,
    "purchased": 3
  }
}
```

### Get Collections

```
GET /pipeline/wishlist/collections
```

**Response:**
```json
{
  "success": true,
  "data": [
    { "name": "Wedding", "count": 12 },
    { "name": "Casual", "count": 20 }
  ]
}
```

### Get Price Drops

```
GET /pipeline/wishlist/price-drops
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "productTitle": "Red Dress",
      "savedPrice": 89.99,
      "currentPrice": 69.99,
      "priceDropPercent": 22.2,
      "priceDropAmount": 20.00
    }
  ]
}
```

### Check If In Wishlist

```
GET /pipeline/wishlist/check/:productId
```

**Response:**
```json
{
  "success": true,
  "data": {
    "isInWishlist": true
  }
}
```

### Add to Wishlist

```
POST /pipeline/wishlist
```

**Request Body:**
```json
{
  "productId": "string (required)",
  "productTitle": "string (required)",
  "productBrand": "string",
  "productImageUrl": "string (required)",
  "productUrl": "string (required)",
  "productCategory": "string",
  "savedPrice": 89.99,
  "savedCurrency": "USD",
  "collectionName": "string",
  "addedFrom": "chat | search | browse",
  "conversationId": "string",
  "notes": {
    "text": "string",
    "tags": ["wedding", "summer"],
    "priority": "low | medium | high",
    "occasion": "string"
  }
}
```

### Remove from Wishlist

```
DELETE /pipeline/wishlist/:productId
```

### Move to Collection

```
PATCH /pipeline/wishlist/:productId/collection
```

**Request Body:**
```json
{
  "collectionName": "Wedding"  // null to remove from collection
}
```

### Update Notes

```
PATCH /pipeline/wishlist/:productId/notes
```

**Request Body:**
```json
{
  "text": "Perfect for the summer wedding",
  "tags": ["wedding", "summer"],
  "priority": "high",
  "occasion": "Wedding"
}
```

### Set Price Alert

```
PATCH /pipeline/wishlist/:productId/alert
```

**Request Body:**
```json
{
  "threshold": 70.00  // Alert when price drops below this
}
```

### Mark as Purchased

```
PATCH /pipeline/wishlist/:productId/purchased
```

---

## Search History API

### Get Recent Searches

```
GET /pipeline/search-history
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| limit | number | 10 | Max results |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "query": "red dress wedding",
      "searchedAt": "2024-01-15T...",
      "resultCount": 45,
      "clickedResults": 3
    }
  ]
}
```

### Get Suggestions (Autocomplete)

```
GET /pipeline/search-history/suggestions
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| prefix | string | - | Search prefix |
| limit | number | 10 | Max suggestions |

**Response:**
```json
{
  "success": true,
  "data": [
    "red dress",
    "red maxi dress",
    "red cocktail dress"
  ]
}
```

### Get User Analytics

```
GET /pipeline/search-history/analytics
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| days | number | 30 | Lookback period |

**Response:**
```json
{
  "success": true,
  "data": {
    "totalSearches": 150,
    "uniqueQueries": 89,
    "topCategories": ["dress", "shoes", "bags"],
    "topBrands": ["Zara", "H&M"],
    "avgResultsClicked": 2.3,
    "searchesByDay": [...]
  }
}
```

### Get Trending (Admin Only)

```
GET /pipeline/search-history/trending
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| hours | number | 24 | Lookback hours |
| limit | number | 10 | Max results |

**Response:**
```json
{
  "success": true,
  "data": [
    { "query": "summer dress", "count": 1250 },
    { "query": "white sneakers", "count": 980 }
  ]
}
```

### Save Search

```
POST /pipeline/search-history
```

**Request Body:**
```json
{
  "query": "string (required)",
  "sessionId": "string",
  "conversationId": "string",
  "source": "chat | direct | voice",
  "filters": {
    "categories": ["dress"],
    "brands": ["Zara"],
    "minPrice": 50,
    "maxPrice": 200
  },
  "results": {
    "totalFound": 150,
    "resultsShown": 20,
    "processingTimeMs": 1234,
    "sources": ["shopstyle", "oxylabs"]
  },
  "detectedIntent": "search_product",
  "intentConfidence": 0.95
}
```

### Update Interaction

```
POST /pipeline/search-history/:searchId/interaction
```

**Request Body:**
```json
{
  "clickedResults": 3,
  "savedProducts": 1,
  "clickedProductIds": ["prod_1", "prod_2"],
  "interactionTimeMs": 45000,
  "refinedQuery": "red maxi dress"
}
```

### Delete Search

```
DELETE /pipeline/search-history/:searchId
```

### Clear All History

```
DELETE /pipeline/search-history
```

---

## Outfit Scoring API

### Score Outfit

Calculate compatibility score for an outfit combination.

```
POST /pipeline/outfit-scoring/score
```

**Request Body:**
```json
{
  "items": [
    {
      "id": "string (required)",
      "category": "top | bottom | dress | outerwear | shoes | bag | accessory",
      "subcategory": "string",
      "dominantColor": "#FFFFFF",
      "colorPalette": ["#FFFFFF", "#000000"],
      "pattern": "solid | stripes | plaid | floral | geometric | abstract | animal",
      "style": ["casual", "minimalist", "bohemian"],
      "occasion": ["casual", "work", "formal", "party"],
      "season": ["spring", "summer", "fall", "winter"],
      "material": "cotton",
      "embedding": [0.1, 0.2, ...]  // Optional: pre-computed embedding
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
      "styleCohesion": 0.85,
      "occasionMatch": 0.75,
      "seasonMatch": 0.8,
      "semanticSimilarity": 0.7
    },
    "issues": [
      "Missing footwear - outfit incomplete"
    ],
    "suggestions": [
      "Add neutral shoes to complete",
      "Consider adding a belt for definition"
    ],
    "confidence": 0.85,
    "interpretation": {
      "rating": "Good",
      "emoji": "👍",
      "message": "Solid outfit choice with good coordination."
    }
  }
}
```

**Score Interpretation:**
| Score | Rating | Description |
|-------|--------|-------------|
| 0.85+ | Excellent | Perfect coordination |
| 0.70-0.84 | Good | Well-coordinated |
| 0.55-0.69 | Fair | Needs adjustments |
| 0.40-0.54 | Needs Work | Consider suggestions |
| <0.40 | Incomplete | Missing items or poor match |

### Get Suggestions

Get suggestions for completing an outfit.

```
POST /pipeline/outfit-scoring/suggestions
```

**Request Body:**
```json
{
  "items": [
    {
      "id": "1",
      "category": "top",
      "dominantColor": "#FFFFFF"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "missingCategory": "bottom",
      "reason": "Outfit needs a bottom piece",
      "preferredAttributes": {
        "colors": ["#000000", "#0000FF"],
        "styles": ["casual"],
        "patterns": ["solid"]
      }
    },
    {
      "missingCategory": "shoes",
      "reason": "Add footwear to complete",
      "preferredAttributes": {
        "colors": ["#FFFFFF", "#000000"],
        "styles": ["casual", "minimalist"]
      }
    }
  ]
}
```

### Find Best Matches

Find items that best match an existing outfit.

```
POST /pipeline/outfit-scoring/best-matches
```

**Request Body:**
```json
{
  "currentItems": [
    { "id": "1", "category": "top", "dominantColor": "#FFFFFF" }
  ],
  "candidateItems": [
    { "id": "2", "category": "bottom", "dominantColor": "#000000" },
    { "id": "3", "category": "bottom", "dominantColor": "#FF0000" },
    { "id": "4", "category": "bottom", "dominantColor": "#0000FF" }
  ],
  "limit": 5
}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "itemId": "2",
      "category": "bottom",
      "score": 0.92,
      "reasons": ["Complementary colors", "Matching style"]
    },
    {
      "itemId": "4",
      "category": "bottom",
      "score": 0.85,
      "reasons": ["Good color contrast"]
    }
  ]
}
```

### Get Scoring Weights

Get information about how outfits are scored.

```
GET /pipeline/outfit-scoring/weights
```

**Response:**
```json
{
  "success": true,
  "data": {
    "colorHarmony": {
      "weight": 0.20,
      "description": "How well colors work together"
    },
    "patternBalance": {
      "weight": 0.15,
      "description": "Pattern mixing compatibility"
    },
    "categoryCompleteness": {
      "weight": 0.20,
      "description": "Has required pieces (top/bottom)"
    },
    "styleCohesion": {
      "weight": 0.15,
      "description": "Style consistency across items"
    },
    "occasionMatch": {
      "weight": 0.10,
      "description": "Items suit same occasions"
    },
    "seasonMatch": {
      "weight": 0.10,
      "description": "Items suit same seasons"
    },
    "semanticSimilarity": {
      "weight": 0.10,
      "description": "AI-based compatibility"
    }
  }
}
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "message": "Error description",
  "error": "ERROR_CODE",
  "statusCode": 400
}
```

**Common Error Codes:**
| Code | Status | Description |
|------|--------|-------------|
| 400 | Bad Request | Invalid request body |
| 401 | Unauthorized | Missing or invalid token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Error | Server error |

---

## Rate Limits

| Endpoint Group | Limit | Window |
|---------------|-------|--------|
| Chat | 10 req | 1 min |
| Search | 30 req | 1 min |
| Wishlist | 60 req | 1 min |
| Outfit Scoring | 30 req | 1 min |

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 8
X-RateLimit-Reset: 1642089600
```
