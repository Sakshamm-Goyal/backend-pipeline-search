import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { generateSlotConstraintsForPrompt } from '../../utilities/slot-category-mapping';

export interface IntentClassification {
  intent: string;
  confidence: number;
  filters: Record<string, any>;
  reasoning: string;
  clarificationNeeded?: string[];
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);
  private client: Anthropic;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required in environment variables');
    }

    this.client = new Anthropic({
      apiKey,
    });

    this.logger.log('Claude service initialized');
  }

  /**
   * Classify user intent using Claude Sonnet 4.5 (recommended)
   * Falls back to Claude Sonnet 4, then Claude Sonnet 3.5 if models are unavailable
   * Uses configurable timeout (default 20 seconds per attempt)
   * 
   * Model IDs from: https://platform.claude.com/docs/en/about-claude/models/overview
   */
  async classifyIntent(
    message: string,
    conversationHistory: Message[],
    userContext: any,
  ): Promise<IntentClassification> {
    const startTime = Date.now();
    // Use specific model versions (not aliases) for production reliability
    // Primary: Claude Sonnet 4.5 (recommended - best balance of intelligence, speed, cost)
    const primaryModel = 'claude-sonnet-4-5-20250929';
    // Fallback 1: Claude Sonnet 4 (legacy)
    const fallbackModel1 = 'claude-sonnet-4-20250514';
    // Fallback 2: Claude Sonnet 3.5 (valid and reliable)
    const fallbackModel2 = 'claude-3-5-sonnet-20241022';
    // Use config timeout or default to 20 seconds (more reasonable than 5s)
    const TIMEOUT_MS = parseInt(
      this.config.get<string>('LLM_TIMEOUT_MS') || '20000',
      10,
    );

    const systemPrompt = this.buildIntentSystemPrompt(userContext);

    // Helper function to create request with timeout
    const createRequestWithTimeout = async (model: string) => {
      return Promise.race([
        this.client.messages.create({
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [
            ...this.formatHistory(conversationHistory),
            { role: 'user', content: message },
          ],
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Request timeout after ${TIMEOUT_MS}ms`)),
            TIMEOUT_MS,
          ),
        ),
      ]) as Promise<any>;
    };

    // Try primary model first
    try {
      const response = await createRequestWithTimeout(primaryModel);

      const firstContent = response.content[0];
      const text = 'text' in firstContent ? firstContent.text : '';
      const result = this.parseIntentResponse(text);

      const duration = Date.now() - startTime;
      this.logger.log(
        `Intent classified: ${result.intent} (confidence: ${result.confidence}) in ${duration}ms`
      );

      return result;
    } catch (error: any) {
      // Check if it's a model unavailability error, timeout, or not found
      const isModelError = 
        error?.error?.error?.type === 'api_error' ||
        error?.error?.error?.type === 'not_found_error' ||
        error?.status === 500 ||
        error?.status === 404 ||
        error?.message?.includes('timeout') ||
        (error?.message?.toLowerCase().includes('unavailable') ||
         error?.error?.error?.message?.toLowerCase().includes('unavailable') ||
         error?.error?.error?.message?.toLowerCase().includes('not found'));

      if (isModelError) {
        // Try first fallback model
        try {
          this.logger.warn(
            `Primary model ${primaryModel} failed (${error?.error?.error?.message || error?.message || 'timeout'}), trying fallback: ${fallbackModel1}`
          );

          const response = await createRequestWithTimeout(fallbackModel1);

          const firstContent = response.content[0];
          const text = 'text' in firstContent ? firstContent.text : '';
          const result = this.parseIntentResponse(text);

          const duration = Date.now() - startTime;
          this.logger.log(
            `Intent classified (fallback 1): ${result.intent} (confidence: ${result.confidence}) in ${duration}ms`
          );

          return result;
        } catch (fallback1Error: any) {
          // Try second fallback model
          try {
            this.logger.warn(
              `Fallback model 1 ${fallbackModel1} failed, trying fallback 2: ${fallbackModel2}`
            );

            const response = await createRequestWithTimeout(fallbackModel2);

            const firstContent = response.content[0];
            const text = 'text' in firstContent ? firstContent.text : '';
            const result = this.parseIntentResponse(text);

            const duration = Date.now() - startTime;
            this.logger.log(
              `Intent classified (fallback 2): ${result.intent} (confidence: ${result.confidence}) in ${duration}ms`
            );

            return result;
          } catch (fallback2Error: any) {
            this.logger.error(
              `All Claude models failed. Primary: ${primaryModel}, Fallback 1: ${fallbackModel1}, Fallback 2: ${fallbackModel2}`,
              { primaryError: error, fallback1Error, fallback2Error }
            );
            throw fallback2Error;
          }
        }
      }

      // If it's not a model error, throw the original error
      this.logger.error('Intent classification failed', error);
      throw error;
    }
  }

  /**
   * Generate a natural clarification question when intent is unclear
   */
  async generateClarification(
    message: string,
    missingFields: string[],
    userContext: any,
  ): Promise<string> {
    const systemPrompt = `You are Elara, a friendly and helpful fashion assistant.

The user's message is unclear or missing important information. Generate a natural, conversational question to clarify what they need.

Missing information: ${missingFields.join(', ')}

IMPORTANT:
- Don't ask for information we already have from the user profile
- Keep it brief and conversational
- Make it feel natural, not robotic
- Focus on the most critical missing piece

USER PROFILE (what we already know):
- Gender: ${userContext.profile?.gender || 'not specified'}
- Style: ${userContext.profile?.primaryStyle || 'not specified'}
- Budget: ${userContext.profile?.priceRange ? `$${userContext.profile.priceRange.min}-${userContext.profile.priceRange.max}` : 'not specified'}`;

    // Use same model configuration as classifyIntent for consistency
    const models = [
      'claude-sonnet-4-5-20250929', // Primary: Claude Sonnet 4.5
      'claude-sonnet-4-20250514',    // Fallback 1: Claude Sonnet 4
      'claude-3-5-sonnet-20241022',  // Fallback 2: Claude Sonnet 3.5
    ];
    const TIMEOUT_MS = parseInt(
      this.config.get<string>('LLM_TIMEOUT_MS') || '20000',
      10,
    );

    // Helper function to create request with timeout
    const createRequestWithTimeout = async (model: string) => {
      return Promise.race([
        this.client.messages.create({
          model,
          max_tokens: 256,
          system: systemPrompt,
          messages: [{ role: 'user', content: message }],
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Request timeout after ${TIMEOUT_MS}ms`)),
            TIMEOUT_MS,
          ),
        ),
      ]) as Promise<any>;
    };

    for (const model of models) {
      try {
        const response = await createRequestWithTimeout(model);

        const firstContent = response.content[0];
        return 'text' in firstContent ? firstContent.text : '';
      } catch (error: any) {
        // If it's the last model, log and return fallback
        if (model === models[models.length - 1]) {
          this.logger.error('Clarification generation failed for all models', error);
          return 'Could you tell me a bit more about what you\'re looking for?';
        }
        // Otherwise, try next model
        this.logger.warn(`Clarification model ${model} failed (${error?.error?.error?.message || error?.message || 'timeout'}), trying next fallback`);
      }
    }

    // Should never reach here, but just in case
    return 'Could you tell me a bit more about what you\'re looking for?';
  }

  private buildIntentSystemPrompt(userContext: any): string {
    const profile = userContext?.profile || {};

    return `You are an intent classifier for Elara, an AI-powered fashion assistant that ONLY helps with fashion, clothing, and style.

USER PROFILE:
- Gender: ${profile.gender || 'not specified'}
- Primary Style: ${profile.primaryStyle || 'not specified'}
- Style Influences: ${profile.selectedStyles?.join(', ') || 'none'}
- Budget Range: $${profile.priceRange?.min || 0}-${profile.priceRange?.max || 'unlimited'}
- Location: ${profile.location?.city || 'not specified'}
- Body Type: ${profile.bodyType || 'not specified'}
- Size: ${profile.size || 'not specified'}

═══════════════════════════════════════════════════════════════════════════════
STEP 1: DOMAIN CHECK (CRITICAL - DO THIS FIRST)
═══════════════════════════════════════════════════════════════════════════════

Before classifying intent, check if the message is about FASHION/CLOTHING/STYLE:

OFF-TOPIC (classify as general_chat with confidence 0.95):
- Technology, AI, APIs, programming, software (e.g., "Google AI Gemini model", "API keys")
- Food, cooking, recipes
- Travel destinations, hotels
- News, politics, current events
- Health, fitness (unless asking about workout clothes)
- Finance, investing, cryptocurrency
- Entertainment (movies, music, games)
- Science, math, physics
- Any topic NOT related to fashion, clothing, accessories, or personal style

If OFF-TOPIC: Return general_chat with reasoning: "Off-topic: [topic]. Elara only assists with fashion."

═══════════════════════════════════════════════════════════════════════════════
STEP 2: CLASSIFY FASHION-RELATED INTENTS
═══════════════════════════════════════════════════════════════════════════════

Only if the message IS about fashion, classify into ONE of these intents:

1. **general_chat**: Greetings, thanks, or off-topic messages
   Examples: "Hi!", "Hello", "Thanks!", "Bye", "Good morning"
   Also use for: Off-topic questions (tech, food, news, etc.)

2. **fashion_advice**: Asking for GENERAL styling tips WITHOUT wanting to browse products

   STRONG INDICATORS (use fashion_advice):
   - "in general" / "generally" / "typically" / "usually"
   - "what looks good WITH [item]" (asking for advice, not products)
   - "what colors go with" / "what matches" (color theory)
   - "how should I style" / "styling tips" / "what pairs well"
   - "what type of" / "what kind of" (seeking advice)
   - Questions about fashion rules, dos and don'ts

   Examples:
   - "In general, what looks good under red pants?" → fashion_advice
   - "What colors go well with navy blue?" → fashion_advice
   - "How should I style a leather jacket?" → fashion_advice
   - "What type of shoes work with wide-leg pants?" → fashion_advice
   - "What looks good with red pants?" → fashion_advice (no action verb like "show me")

3. **product_search**: User wants to SEE/BROWSE/BUY a SINGLE TYPE of product (no occasion)

   REQUIRED INDICATORS (must have at least one):
   - "show me" / "find me" / "search for" / "look up"
   - "I need" / "I want" / "I'm looking for" / "I want to buy"
   - "can you find" / "get me" / "send me links"
   - Direct item requests with clear shopping intent
   - NO occasion/event mentioned

   Examples:
   - "Show me blue jeans" → product_search
   - "Find me red shirts" → product_search
   - "I want Nike sneakers" → product_search

4. **outfit_request**: Wants COMPLETE outfit OR mentions an OCCASION/EVENT
   IMPORTANT: This is the intent when user wants a COMPLETE LOOK or mentions ANY occasion!

   KEY INDICATORS (use outfit_request if ANY of these):
   - Mentions occasion: wedding, date, interview, party, work, gym, cocktail, event, dinner, brunch, casual outing
   - Asks for "outfit", "complete look", "what to wear", "what should I wear"
   - Asks for dress/formal wear for an event (e.g., "cocktail dress for event" = outfit_request!)
   - Mentions body type considerations ("plus-size", "flattering")
   - Asks for recommendations with multiple criteria (occasion + style + budget)

   Examples:
   - "What should I wear to a wedding?" → outfit_request
   - "Outfit for date night" → outfit_request
   - "I'm looking for a cocktail dress for an event" → outfit_request (HAS EVENT!)
   - "I need something flattering for a party" → outfit_request
   - "Looking for plus-size dress for dinner" → outfit_request
   - "Help me find something to wear to work" → outfit_request

5. **single_item_search**: Searching for ONE specific item WITH brand/specs (no occasion)
   Examples: "Show me Nike Air Max", "I want a leather jacket under $200"

6. **item_replacement**: Replace an item in a previously shown outfit
   Key: References "outfit 1/2/3" or "the top/shoes in that outfit"
   Examples: "Can I get a different top for outfit 2?", "Show me other shoe options"

7. **feedback**: Like/dislike on recommendations OR preference/constraint updates

   USE feedback WHEN USER IS:
   - Expressing like/dislike: "I like option 1", "Not a fan of this", "Love it!"
   - Setting constraints/preferences for future recommendations:
     - "avoid black from now on" → feedback (constraint update)
     - "no more red items" → feedback (constraint update)
     - "I prefer Zara and Uniqlo" → feedback (brand preference)
     - "I like Zara and Uniqlo the most" → feedback (brand preference)
     - "I don't like shiny fabrics" → feedback (material constraint)
     - "keep it under $100 total" → feedback (budget constraint)
     - "this is too expensive" → feedback (budget feedback)
   - Expressing style preferences:
     - "I prefer minimal outfits" → feedback (style preference)
     - "no big logos or busy prints" → feedback (style constraint)

   KEY INDICATORS FOR feedback:
   - "avoid" / "no more" / "don't want" / "from now on"
   - "I prefer" / "I like [brand/style]" / "I don't like"
   - "too expensive" / "keep it under"
   - Setting rules for future recommendations

   Examples:
   - "avoid black from now on" → feedback
   - "I like Zara and Uniqlo the most" → feedback
   - "I prefer minimal outfits — no big logos" → feedback
   - "this is too expensive, keep it under $120 total" → feedback
   - "I don't like shiny fabrics" → feedback

8. **clarification_needed**: ONLY when truly ambiguous AND confidence < 0.7

═══════════════════════════════════════════════════════════════════════════════
CRITICAL DECISION RULES
═══════════════════════════════════════════════════════════════════════════════

product_search vs outfit_request - THE KEY DIFFERENCE:

| Query | Intent | Why |
|-------|--------|-----|
| "Show me red shirts" | product_search | Simple product, no occasion |
| "Red dress for party" | outfit_request | HAS OCCASION (party) |
| "I need jeans" | product_search | Simple product, no occasion |
| "I need outfit for interview" | outfit_request | HAS OCCASION (interview) |
| "Find cocktail dress" | product_search | Just a product type |
| "Cocktail dress for event" | outfit_request | HAS OCCASION (event)! |
| "Plus-size dress that's flattering" | outfit_request | Body considerations = wants complete look |
| "Show me Nike shoes" | product_search | Brand + product, no occasion |

CONFIDENCE GUIDELINES:
- Off-topic messages: 0.95 confidence for general_chat
- Has occasion/event mentioned: 0.95+ confidence for outfit_request
- Clear fashion_advice (has indicators): 0.9+ confidence
- Clear product_search (no occasion): 0.9+ confidence
- Ambiguous: 0.6-0.8 confidence

EXTRACTION RULES (CRITICAL - extract ALL mentioned attributes):
- **occasion**: casual, formal, business, party, date, workout, travel, cocktail, dinner, wedding, interview, brunch
- **itemType**: THE CORE CLOTHING TYPE (dress, shirt, pants, shoes, heels, jeans, skirt, jacket, etc.)
  CRITICAL: Extract ONLY the base garment type, NOT size/style modifiers!
  Examples:
    - "plus size formal dress" → itemType: "dress" (NOT "plus size dress")
    - "black cocktail dress" → itemType: "cocktail dress"
    - "slim fit jeans" → itemType: "jeans"
    - "high heels" → itemType: "heels"
    - "formal shoes" → itemType: "shoes"
  The itemType should be searchable on a fashion retailer site!
- **color**: any colors mentioned
- **brand**: specific brands mentioned
- **priceRange**: budget if mentioned (e.g., "$150" → max: 150, "under $200" → max: 200)
- **style**: style descriptors (formal, minimal, edgy, bohemian, flattering, elegant, etc.)
- **size**: body/clothing size (plus-size, petite, US 20, XL, etc.) - NOT part of itemType!
- **features**: specific features requested (sleeves, v-neck, high-waist, etc.)
- **gender**: infer from context if not explicit (cocktail dress → female)

SIZE vs STYLE CLARIFICATION:
- "plus-size" / "plus size" / "curvy" → size field
- "formal" / "casual" / "elegant" → style field
- "dress" / "shirt" / "pants" → itemType field
Example: "plus size formal dresses" extracts: itemType="dress", size="plus-size", style="formal"

RESPONSE FORMAT (JSON):
{
  "intent": "string (one of the 8 intents)",
  "confidence": 0.0-1.0,
  "filters": {
    "occasion": "string or null",
    "itemType": "string or null (e.g., 'cocktail dress', 'shirt', 'jeans')",
    "color": ["array of color strings"],
    "brand": ["array of brand strings"],
    "priceRange": { "min": number, "max": number } or null,
    "style": "string or null",
    "size": "string or null (e.g., 'US 20', 'plus-size', 'XL')",
    "features": ["array of feature strings (e.g., 'sleeves', 'flattering')"],
    "gender": "male" | "female" | "unisex" | null
  },
  "reasoning": "brief 1-sentence explanation",
  "clarificationNeeded": ["field1", "field2"] // only if confidence < 0.7
}`;
  }

  private formatHistory(history: Message[]): any[] {
    // Take last 5 messages for context
    return history.slice(-5).map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    }));
  }

/**
   * Generate outfit recommendations using Claude Sonnet
   * More reliable JSON output than Gemini for structured responses
   */
  async generateOutfitRecommendations(
    userQuery: string,
    userContext: any,
    slotProducts: Map<string, any[]>,
    filters: any,
  ): Promise<any[]> {
    const startTime = Date.now();
    const TIMEOUT_MS = parseInt(this.config.get<string>('LLM_TIMEOUT_MS') || '30000', 10);

    const prompt = this.buildOutfitPrompt(userQuery, userContext, slotProducts, filters);

    try {
      const response = await Promise.race([
        this.client.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          system: 'You are an expert fashion stylist. Always respond with valid JSON only, no markdown code blocks.',
          messages: [{ role: 'user', content: prompt }],
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Outfit generation timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
        ),
      ]) as any;

      const firstContent = response.content[0];
      const text = 'text' in firstContent ? firstContent.text : '';

      let outfits = this.parseOutfitResponse(text);

      // Ensure variety in main garments across outfits
      outfits = this.ensureOutfitVariety(outfits, slotProducts);

      const duration = Date.now() - startTime;
      this.logger.log(`Generated ${outfits.length} outfit recommendations in ${duration}ms using Claude`);

      return outfits;
    } catch (error: any) {
      this.logger.error(`Outfit generation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Ensure outfits have variety in main garments (dress, top, bottom)
   * If duplicates are found, swap with available alternatives
   */
  private ensureOutfitVariety(
    outfits: any[],
    slotProducts: Map<string, any[]>,
  ): any[] {
    if (outfits.length <= 1) return outfits;

    const mainSlots = ['dress', 'top', 'bottom'];

    // Track used product IDs per slot across all outfits
    const usedProductsBySlot = new Map<string, Set<string>>();

    for (const outfit of outfits) {
      for (const item of outfit.items || []) {
        const slot = item.slot?.toLowerCase();
        if (mainSlots.includes(slot)) {
          if (!usedProductsBySlot.has(slot)) {
            usedProductsBySlot.set(slot, new Set());
          }

          const usedIds = usedProductsBySlot.get(slot)!;

          // Check if this product was already used
          if (usedIds.has(item.productId)) {
            // Find an alternative
            const alternatives = slotProducts.get(slot) || slotProducts.get(item.slot) || [];
            const alternative = alternatives.find(p => {
              const pId = p.id || p._id;
              return !usedIds.has(pId);
            });

            if (alternative) {
              const newId = alternative.id || alternative._id;
              this.logger.log(`[Claude] Swapping duplicate ${slot} product: ${item.productId} -> ${newId}`);
              item.productId = newId;
              item.selectionReason = `${item.selectionReason} (selected for variety)`;
              usedIds.add(newId);
            } else {
              this.logger.warn(`[Claude] No alternative found for duplicate ${slot} product: ${item.productId}`);
            }
          } else {
            usedIds.add(item.productId);
          }
        }
      }
    }

    return outfits;
  }

  private buildOutfitPrompt(
    userQuery: string,
    context: any,
    slotProducts: Map<string, any[]>,
    filters: any,
  ): string {
    const profile = context.profile || {};

    return `You are an expert personal stylist. Create outfit combinations from the available products.

USER PROFILE:
- Gender: ${profile.gender || 'not specified'}
- Primary Style: ${profile.primaryStyle || 'versatile'}
- Style Influences: ${profile.selectedStyles?.join(', ') || 'open to all styles'}
- Budget Range: $${profile.priceRange?.min || 0} - $${profile.priceRange?.max || 'unlimited'}

REQUEST:
- Occasion: ${filters.occasion || 'everyday casual'}
- Query: "${userQuery}"
${filters.color?.length ? `- Colors: ${filters.color.join(', ')}` : ''}

AVAILABLE PRODUCTS BY SLOT:
${this.formatSlotProductsForPrompt(slotProducts)}

TASK: Create exactly 3 distinct outfit combinations.

CRITICAL RULES:
1. Use the EXACT productId values from the product list above. Each item MUST have a valid productId.
2. ONLY ONE item per major slot (top, bottom, dress, shoes, outerwear) - NO DUPLICATES!
3. Do NOT repeat the same slot in an outfit (e.g., do NOT include 2 tops or 2 shoes)
4. For men's outfits: 1 top + 1 bottom + 1 shoes + 2-3 accessories
5. For women's outfits: 1 dress OR (1 top + 1 bottom) + 1 shoes + 3-4 accessories

*** VERY IMPORTANT - PRODUCT VARIETY RULE ***
EACH OF THE 3 OUTFITS MUST USE A DIFFERENT MAIN GARMENT (dress/top/bottom).
- If there are dresses available, Outfit 1 should use product #1-3, Outfit 2 should use product #4-6, Outfit 3 should use product #7-8
- NEVER use the same dress, top, or main garment in multiple outfits
- The PRIMARY purpose of generating 3 outfits is to show VARIETY - using the same main item defeats this purpose
- If the slot has 8 dresses, use dress #1 for outfit 1, dress #4 for outfit 2, dress #7 for outfit 3 (spread them out!)
- Shoes and accessories CAN repeat if necessary, but main garments MUST be different

${generateSlotConstraintsForPrompt(slotProducts)}

Respond with ONLY valid JSON (no markdown, no code blocks):
{
  "outfits": [
    {
      "name": "Outfit Name",
      "style": "party/casual/formal/etc",
      "items": [
        {"slot": "dress", "productId": "EXACT_ID_FROM_LIST", "selectionReason": "Why selected"},
        {"slot": "shoes", "productId": "EXACT_ID_FROM_LIST", "selectionReason": "Why selected"}
      ],
      "totalPrice": 199.99,
      "colorScheme": "analogous/complementary/monochromatic",
      "styleNotes": "Styling tip",
      "wardrobeSynergy": "Works with existing pieces",
      "occasionFit": "Perfect for the occasion"
    }
  ]
}`;
  }

  private formatSlotProductsForPrompt(slotProducts: Map<string, any[]>): string {
    const lines: string[] = [];

    slotProducts.forEach((products, slot) => {
      lines.push(`\n[${slot.toUpperCase()}]:`);

      const limitedProducts = products.slice(0, 8);
      limitedProducts.forEach((p, i) => {
        const productId = p.id || p._id || `product-${slot}-${i}`;
        lines.push(
          `  ${i + 1}. productId="${productId}" | ${p.title?.substring(0, 60)} | $${p.price?.toFixed(2) || 'N/A'} | ${p.brand || 'Unknown'} | Color: ${p.color || 'N/A'}`
        );
      });
    });

    return lines.join('\n');
  }

  private parseOutfitResponse(text: string): any[] {
    try {
      // Try to extract JSON - Claude should return clean JSON
      let jsonText = text.trim();

      // Remove markdown code blocks if present
      const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
      } else {
        // Find JSON object
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonText = jsonMatch[0];
        }
      }

      const parsed = JSON.parse(jsonText);

      if (!parsed.outfits || !Array.isArray(parsed.outfits)) {
        this.logger.warn('Invalid outfit response structure from Claude');
        return [];
      }

      // Validate and log product IDs
      parsed.outfits.forEach((outfit: any, idx: number) => {
        if (outfit.items) {
          outfit.items.forEach((item: any) => {
            if (!item.productId || item.productId === 'undefined') {
              this.logger.warn(`Claude Outfit ${idx + 1}, slot ${item.slot}: Missing productId`);
            } else {
              this.logger.debug(`Claude Outfit ${idx + 1}, slot ${item.slot}: productId=${item.productId}`);
            }
          });
        }
      });

      return parsed.outfits;
    } catch (error) {
      this.logger.error('Failed to parse Claude outfit response', error);
      this.logger.debug('Raw response:', text.substring(0, 500));
      return [];
    }
  }

  private parseIntentResponse(text: string): IntentClassification {
    try {
      // Try to extract JSON from markdown code blocks
      let jsonText = text;

      // Check for markdown code block
      const codeBlockMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1];
      } else {
        // Try to find JSON object
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonText = jsonMatch[0];
        }
      }

      const parsed = JSON.parse(jsonText);

      return {
        intent: parsed.intent,
        confidence: parsed.confidence,
        filters: parsed.filters || {},
        reasoning: parsed.reasoning,
        clarificationNeeded: parsed.clarificationNeeded,
      };
    } catch (error) {
      this.logger.error('Failed to parse intent response', error);
      this.logger.debug('Raw response:', text);

      // Fallback to general_chat with low confidence
      return {
        intent: 'general_chat',
        confidence: 0.5,
        filters: {},
        reasoning: 'Failed to parse response, defaulting to chat',
      };
    }
  }

  /**
   * Generate a JSON response from Claude
   * Used for structured reasoning tasks (color pairing, outfit scoring, etc.)
   */
  async generateJSON(prompt: string): Promise<any> {
    const startTime = Date.now();

    // Use same model configuration as other methods
    const models = [
      'claude-sonnet-4-5-20250929', // Primary: Claude Sonnet 4.5
      'claude-sonnet-4-20250514',    // Fallback 1: Claude Sonnet 4
      'claude-3-5-sonnet-20241022',  // Fallback 2: Claude Sonnet 3.5
    ];
    const TIMEOUT_MS = parseInt(
      this.config.get<string>('LLM_TIMEOUT_MS') || '15000',
      10,
    );

    const systemPrompt = `You are a fashion expert AI. Respond with valid JSON only, no additional text or markdown.
Always output a complete JSON object or array as specified in the user's prompt.`;

    // Helper function to create request with timeout
    const createRequestWithTimeout = async (model: string) => {
      return Promise.race([
        this.client.messages.create({
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: prompt }],
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout after ${TIMEOUT_MS}ms for model ${model}`)),
            TIMEOUT_MS,
          ),
        ),
      ]) as Promise<Anthropic.Message>;
    };

    let lastError: Error | null = null;

    for (const model of models) {
      try {
        this.logger.debug(`Attempting JSON generation with ${model}...`);
        const response = await createRequestWithTimeout(model);
        const elapsed = Date.now() - startTime;

        const textContent = response.content.find(
          (block: any) => block.type === 'text',
        );
        if (!textContent || textContent.type !== 'text') {
          throw new Error('No text content in response');
        }

        const text = textContent.text;

        // Extract JSON from response (handle potential markdown code blocks)
        let jsonText = text.trim();
        if (jsonText.startsWith('```json')) {
          jsonText = jsonText.slice(7);
        } else if (jsonText.startsWith('```')) {
          jsonText = jsonText.slice(3);
        }
        if (jsonText.endsWith('```')) {
          jsonText = jsonText.slice(0, -3);
        }
        jsonText = jsonText.trim();

        const parsed = JSON.parse(jsonText);
        this.logger.debug(`JSON generated successfully with ${model} in ${elapsed}ms`);
        return parsed;
      } catch (error: any) {
        lastError = error;
        this.logger.warn(
          `JSON generation with ${model} failed: ${error.message}`,
        );

        // If it's a model not found error, try the next model
        if (
          error.status === 404 ||
          error.message?.includes('model:') ||
          error.message?.includes('not found')
        ) {
          this.logger.debug(`Model ${model} not available, trying fallback...`);
          continue;
        }

        // For timeout errors, try next model
        if (error.message?.includes('Timeout')) {
          this.logger.debug(`Model ${model} timed out, trying fallback...`);
          continue;
        }
      }
    }

    // All models failed
    throw lastError || new Error('All Claude models failed for JSON generation');
  }
}
