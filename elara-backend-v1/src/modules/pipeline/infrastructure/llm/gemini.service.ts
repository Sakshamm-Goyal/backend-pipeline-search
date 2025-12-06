import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateSlotConstraintsForPrompt } from '../../utilities/slot-category-mapping';

export interface OutfitRecommendation {
  name: string;
  style: string;
  items: Array<{
    slot: string;
    productId: string;
    selectionReason: string;
  }>;
  totalPrice: number;
  colorScheme: string;
  styleNotes: string;
  wardrobeSynergy: string;
  occasionFit: string;
}

export interface RankedProduct {
  product: any;
  originalRank: number;
  newRank: number;
  reasoning: string;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private genAI: GoogleGenerativeAI;
  private model: any;
  private chatModel: any;

  // Model fallback chain (most stable to experimental)
  // FIXED: Using stable models that are known to work
  private readonly MODEL_CHAIN = [
    'gemini-2.0-flash-exp',      // Fast, stable, good for JSON
    'gemini-1.5-pro',            // Reliable fallback
    'gemini-1.5-flash',          // Fast final fallback
  ];

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('GOOGLE_AI_API_KEY');
    if (!apiKey) {
      throw new Error('GOOGLE_AI_API_KEY is required in environment variables');
    }

    this.genAI = new GoogleGenerativeAI(apiKey);

    // Model for JSON responses (outfits, rankings) - using stable model
    this.model = this.genAI.getGenerativeModel({
      model: this.MODEL_CHAIN[0], // gemini-2.0-flash-exp (stable)
      generationConfig: {
        temperature: 0.7, // Some creativity for outfit combinations
        maxOutputTokens: 8192, // Increased from 4096 to handle full outfit responses
        responseMimeType: 'application/json',
      },
    });

    // Model for text chat responses
    this.chatModel = this.genAI.getGenerativeModel({
      model: this.MODEL_CHAIN[0], // Use same stable model
      generationConfig: {
        temperature: 0.8, // More creative for conversational responses
        maxOutputTokens: 1024,
      },
    });

    this.logger.log(`Gemini service initialized with model: ${this.MODEL_CHAIN[0]}`);
  } 

  /**
   * Generate 3 personalized outfit recommendations
   */
  async generateOutfitRecommendations(
    userQuery: string,
    userContext: any,
    slotProducts: Map<string, any[]>,
    filters: any,
  ): Promise<OutfitRecommendation[]> {
    const startTime = Date.now();

    try {
      const prompt = this.buildOutfitPrompt(userQuery, userContext, slotProducts, filters);

      // Log available products for debugging
      this.logger.debug(`Generating outfits for query: "${userQuery}"`);
      this.logger.debug(`Available slots: ${Array.from(slotProducts.keys()).join(', ')}`);
      slotProducts.forEach((products, slot) => {
        this.logger.debug(`  ${slot}: ${products.length} products`);
      });

      const result = await this.model.generateContent(prompt);
      const response = result.response.text();

      // Log raw response for debugging
      if (!response || response.trim() === '') {
        this.logger.warn('Gemini 3 Pro returned empty response, checking for safety/block reasons');

        // Check for blocked content or other issues
        const candidates = result.response.candidates;
        if (candidates && candidates.length > 0) {
          const candidate = candidates[0];
          if (candidate.finishReason) {
            this.logger.warn(`Finish reason: ${candidate.finishReason}`);
          }
          if (candidate.safetyRatings) {
            this.logger.warn(`Safety ratings: ${JSON.stringify(candidate.safetyRatings)}`);
          }
        }

        // Try fallback model
        this.logger.log('Trying fallback model due to empty response...');
        return this.generateOutfitsWithFallback(userQuery, userContext, slotProducts, filters);
      }

      this.logger.debug(`Gemini response length: ${response.length} chars`);

      let outfits = this.parseOutfitResponse(response);

      // Ensure variety in main garments across outfits
      outfits = this.ensureOutfitVariety(outfits, slotProducts);

      const duration = Date.now() - startTime;
      this.logger.log(
        `Generated ${outfits.length} outfit recommendations in ${duration}ms`
      );

      return outfits;
    } catch (error: any) {
      this.logger.error(`Outfit generation failed: ${error.message}`);
      this.logger.error(error.stack);

      // Check if it's a model availability issue
      if (error.message?.includes('not found') || error.message?.includes('404')) {
        this.logger.warn('Model may not be available, trying fallback model...');
        return this.generateOutfitsWithFallback(userQuery, userContext, slotProducts, filters);
      }

      throw error;
    }
  }

  /**
   * Fallback outfit generation with full model chain
   * ENHANCED: Tries all models in chain, then generates deterministic fallback
   */
  private async generateOutfitsWithFallback(
    userQuery: string,
    userContext: any,
    slotProducts: Map<string, any[]>,
    filters: any,
  ): Promise<OutfitRecommendation[]> {
    const prompt = this.buildOutfitPrompt(userQuery, userContext, slotProducts, filters);

    // Try each model in the fallback chain
    for (let i = 1; i < this.MODEL_CHAIN.length; i++) {
      const modelName = this.MODEL_CHAIN[i];
      this.logger.log(`Attempting fallback model ${i}: ${modelName}...`);

      try {
        const fallbackModel = this.genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
          },
        });

        const result = await fallbackModel.generateContent(prompt);
        const response = result.response.text();

        if (response && response.trim() !== '') {
          this.logger.log(`Fallback model ${modelName} returned ${response.length} chars`);
          let outfits = this.parseOutfitResponse(response);
          if (outfits.length > 0) {
            // Ensure variety in main garments across outfits
            outfits = this.ensureOutfitVariety(outfits, slotProducts);
            return outfits;
          }
        }
        this.logger.warn(`Fallback model ${modelName} returned empty/invalid response`);
      } catch (error: any) {
        this.logger.warn(`Fallback model ${modelName} failed: ${error.message}`);
      }
    }

    // FINAL FALLBACK: Generate deterministic outfits from available products
    this.logger.warn('All LLM models failed, generating deterministic fallback outfits');
    return this.generateDeterministicOutfits(slotProducts, userContext, filters);
  }

  /**
   * Generate deterministic outfits when all LLM models fail
   * CRITICAL: Ensures user always gets some outfit recommendations
   */
  private generateDeterministicOutfits(
    slotProducts: Map<string, any[]>,
    userContext: any,
    filters: any,
  ): OutfitRecommendation[] {
    const outfits: OutfitRecommendation[] = [];
    const slots = Array.from(slotProducts.keys());

    if (slots.length === 0) {
      this.logger.warn('No products available for deterministic outfit generation');
      return [];
    }

    // Generate up to 3 outfits by rotating through product options
    for (let outfitIdx = 0; outfitIdx < 3; outfitIdx++) {
      const items: Array<{ slot: string; productId: string; selectionReason: string }> = [];
      let totalPrice = 0;

      for (const slot of slots) {
        const products = slotProducts.get(slot) || [];
        if (products.length > 0) {
          // Pick different product for each outfit (rotate through available)
          const productIdx = outfitIdx % products.length;
          const product = products[productIdx];
          items.push({
            slot,
            productId: product.id || product._id || `${slot}-${productIdx}`,
            selectionReason: 'Selected based on availability and style match',
          });
          totalPrice += product.price || 0;
        }
      }

      if (items.length >= 2) { // At least 2 items for an outfit
        outfits.push({
          name: `Outfit ${outfitIdx + 1}`,
          style: filters?.occasion || 'casual',
          items,
          totalPrice,
          colorScheme: 'neutral',
          styleNotes: 'A stylish combination selected for you',
          wardrobeSynergy: 'Versatile pieces that work with many items',
          occasionFit: `Appropriate for ${filters?.occasion || 'everyday wear'}`,
        });
      }
    }

    this.logger.log(`Generated ${outfits.length} deterministic fallback outfits`);
    return outfits;
  }

  /**
   * Check if we have enough products to generate outfits
   */
  validateSlotProducts(slotProducts: Map<string, any[]>): boolean {
    const totalProducts = Array.from(slotProducts.values()).reduce(
      (sum, products) => sum + products.length,
      0
    );

    if (totalProducts < 3) {
      this.logger.warn(`Not enough products to generate outfits: ${totalProducts} total`);
      return false;
    }

    return true;
  }

  /**
   * Rerank products using LLM when scores are too close
   */
  async rerankProducts(
    products: any[],
    userPreferences: any,
    context: string,
  ): Promise<RankedProduct[]> {
    if (products.length === 0) return [];

    try {
      const prompt = this.buildRerankPrompt(products, userPreferences, context);

      const result = await this.model.generateContent(prompt);
      const response = JSON.parse(result.response.text());

      // Apply new ranking
      const reranked: RankedProduct[] = response.ranking
        .map((newIdx: number, position: number) => {
          const product = products[newIdx - 1];
          if (!product) return null;

          return {
            product,
            originalRank: newIdx,
            newRank: position + 1,
            reasoning: response.reasoning,
          };
        })
        .filter(Boolean);

      this.logger.log(`Reranked ${reranked.length} products`);
      return reranked;
    } catch (error) {
      this.logger.warn('Product reranking failed, returning original order', error);

      // Return original order with metadata
      return products.map((product, index) => ({
        product,
        originalRank: index + 1,
        newRank: index + 1,
        reasoning: 'Reranking failed, using original order',
      }));
    }
  }

  private buildOutfitPrompt(
    userQuery: string,
    context: any,
    slotProducts: Map<string, any[]>,
    filters: any,
  ): string {
    const profile = context.profile || {};

    return `You are an expert personal stylist creating outfit combinations for Elara, an AI fashion assistant.

USER PROFILE:
- Gender: ${profile.gender || 'not specified'}
- Primary Style: ${profile.primaryStyle || 'versatile'}
- Style Influences: ${profile.selectedStyles?.join(', ') || 'open to all styles'}
- Liked Brands: ${profile.likedBrands?.join(', ') || 'open to all brands'}
- Color Preferences: ${profile.colorPreferences?.join(', ') || 'no specific preference'}
- Colors to Avoid: ${profile.avoidColors?.join(', ') || 'none'}
- Budget Range: $${profile.priceRange?.min || 0} - $${profile.priceRange?.max || 'unlimited'}
- Modest Dressing: ${profile.modestDressing ? 'Yes - prefers more coverage' : 'No specific requirement'}

USER'S WARDROBE CONTEXT:
- Dominant Colors in Wardrobe: ${context.wardrobeColors?.join(', ') || 'unknown'}
- Compatible Existing Pieces: ${this.formatCompatiblePieces(context.compatiblePieces)}

REQUEST DETAILS:
- Occasion: ${filters.occasion || 'everyday casual'}
- Specific Request: "${userQuery}"
${filters.color?.length ? `- Requested Colors: ${filters.color.join(', ')}` : ''}
${filters.style ? `- Requested Style: ${filters.style}` : ''}

AVAILABLE PRODUCTS BY CLOTHING SLOT:
${this.formatSlotProducts(slotProducts)}

YOUR TASK:
Create exactly 3 distinct outfit combinations. For each outfit:

1. SELECT exactly ONE product from each slot
2. ENSURE excellent color harmony (complementary, monochromatic, analogous, or neutral schemes)
3. MATCH the user's style preferences and lifestyle
4. STAY within budget (calculate total price)
5. EXPLAIN how new items work with existing wardrobe pieces
6. VALIDATE that the outfit suits the requested occasion

CRITICAL REQUIREMENTS:
✓ Don't mix inappropriate formality levels (e.g., formal blazer with gym shorts)
✓ Respect modest dressing requirements if specified
✓ Prioritize liked brands when available
✓ Ensure colors actually complement each other (not just random)
✓ Verify total price is within budget
✓ Each outfit must be distinctly different in style/vibe

*** VERY IMPORTANT - PRODUCT VARIETY RULE ***
EACH OF THE 3 OUTFITS MUST USE A DIFFERENT MAIN GARMENT (dress/top/bottom).
- If there are dresses available, Outfit 1 should use product #1-3, Outfit 2 should use product #4-6, Outfit 3 should use product #7-10
- NEVER use the same dress, top, or main garment in multiple outfits
- The PRIMARY purpose of generating 3 outfits is to show VARIETY - using the same main item defeats this purpose
- If the slot has 10 dresses, use dress #1 for outfit 1, dress #4 for outfit 2, dress #7 for outfit 3 (spread them out!)
- Shoes and accessories CAN repeat if necessary, but main garments MUST be different

RESPOND IN THIS EXACT JSON FORMAT:
{
  "outfits": [
    {
      "name": "Elegant Evening Look",
      "style": "party",
      "items": [
        {"slot": "dress", "productId": "asos_scraper-asos_12345", "selectionReason": "Perfect blue color for party"},
        {"slot": "shoes", "productId": "oxylabs-67890", "selectionReason": "Elegant heels that complement the dress"},
        {"slot": "watch", "productId": "asos_scraper-asos_11111", "selectionReason": "Subtle accessory"}
      ],
      "totalPrice": 199.99,
      "colorScheme": "analogous",
      "styleNotes": "Style with statement earrings",
      "wardrobeSynergy": "Works with existing neutral pieces",
      "occasionFit": "Perfect for cocktail parties"
    }
  ]
}

CRITICAL - READ THIS CAREFULLY:
1. The "productId" field MUST be the EXACT ID from the product list above - look for [ID: xxx] and copy the xxx part
2. Example: If you see "[ID: asos_scraper-asos_208561296]", then use "productId": "asos_scraper-asos_208561296"
3. Include one item per available slot from the product list
4. Each outfit MUST have: main garment + shoes + at least one accessory

${generateSlotConstraintsForPrompt(slotProducts)}`;
  }

  private buildRerankPrompt(
    products: any[],
    preferences: any,
    context: string,
  ): string {
    return `You are a fashion expert. Rerank these ${products.length} products for best fit with user preferences.

USER PREFERENCES:
${JSON.stringify(preferences, null, 2)}

CONTEXT: ${context}

PRODUCTS TO RANK:
${products.map((p, i) => `${i + 1}. ${p.title} - $${p.price} (${p.brand || 'Unknown brand'}) [${p.color || 'No color specified'}]`).join('\n')}

TASK: Reorder these products from best to worst fit for this user.

Consider:
- Style match with user preferences
- Brand fit (liked vs neutral vs disliked)
- Color harmony with existing wardrobe
- Price value within budget
- Quality signals (brand reputation, reviews if available)

Respond in JSON:
{
  "ranking": [3, 1, 5, 2, 4, ...],
  "reasoning": "Brief explanation of why top items rank highest"
}

The "ranking" array should contain the numbers 1-${products.length} in your new preferred order.`;
  }

  private formatSlotProducts(slotProducts: Map<string, any[]>): string {
    const lines: string[] = [];

    slotProducts.forEach((products, slot) => {
      // Use lowercase slot names consistently (e.g., "dress:", "shoes:")
      // This helps Gemini return lowercase slot names in response
      const slotLabel = slot.toLowerCase().replace(/_/g, ' ');
      lines.push(`\n[SLOT: ${slot}] ${slotLabel.charAt(0).toUpperCase() + slotLabel.slice(1)}:`);

      const limitedProducts = products.slice(0, 10); // Show top 10 per slot
      limitedProducts.forEach((p, i) => {
        const productId = p.id || p._id || `product-${slot}-${i}`;
        lines.push(
          `  ${i + 1}. [ID: ${productId}] ${p.title} - $${p.price?.toFixed(2) || 'N/A'} (${p.brand || 'Unknown'}) [Color: ${p.color || 'N/A'}]`
        );
      });

      if (products.length > 10) {
        lines.push(`  ... and ${products.length - 10} more options`);
      }
    });

    return lines.join('\n');
  }

  private formatCompatiblePieces(pieces: any[]): string {
    if (!pieces || pieces.length === 0) {
      return 'No specific pieces selected';
    }

    return pieces
      .slice(0, 5) // Show up to 5 pieces
      .map(p => `${p.category}: ${p.name} (${p.color || 'no color specified'})`)
      .join(', ');
  }

  private parseOutfitResponse(text: string): OutfitRecommendation[] {
    try {
      const parsed = JSON.parse(text);

      if (!parsed.outfits || !Array.isArray(parsed.outfits)) {
        this.logger.warn('Invalid outfit response structure');
        return [];
      }

      // Log raw response for debugging (first 500 chars)
      this.logger.debug(`Raw Gemini response sample: ${text.substring(0, 500)}...`);

      // Normalize and validate productIds - Gemini may use product_id instead of productId
      parsed.outfits.forEach((outfit: any, idx: number) => {
        if (outfit.items) {
          outfit.items.forEach((item: any) => {
            // Log all item keys to debug what Gemini is returning
            this.logger.debug(`Outfit ${idx + 1}, slot ${item.slot}: item keys = ${Object.keys(item).join(', ')}`);

            // Normalize: Gemini might return product_id instead of productId
            if (!item.productId && item.product_id) {
              item.productId = item.product_id;
              this.logger.debug(`Normalized product_id to productId: ${item.productId}`);
            }

            // Also check for id field
            if (!item.productId && item.id) {
              item.productId = item.id;
              this.logger.debug(`Normalized id to productId: ${item.productId}`);
            }

            if (!item.productId || item.productId === 'undefined') {
              this.logger.warn(`Outfit ${idx + 1}, slot ${item.slot}: Missing or invalid productId after normalization`);
              this.logger.warn(`Item data: ${JSON.stringify(item).substring(0, 200)}`);
            } else {
              this.logger.debug(`Outfit ${idx + 1}, slot ${item.slot}: productId=${item.productId}`);
            }
          });
        }
      });

      return parsed.outfits;
    } catch (error) {
      this.logger.error('Failed to parse outfit response', error);
      this.logger.debug('Raw response:', text.substring(0, 500));
      return [];
    }
  }

  /**
   * Ensure outfits have variety in main garments (dress, top, bottom)
   * If duplicates are found, swap with available alternatives
   */
  ensureOutfitVariety(
    outfits: OutfitRecommendation[],
    slotProducts: Map<string, any[]>,
  ): OutfitRecommendation[] {
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
              this.logger.log(`Swapping duplicate ${slot} product: ${item.productId} -> ${newId}`);
              item.productId = newId;
              item.selectionReason = `${item.selectionReason} (selected for variety)`;
              usedIds.add(newId);
            } else {
              this.logger.warn(`No alternative found for duplicate ${slot} product: ${item.productId}`);
            }
          } else {
            usedIds.add(item.productId);
          }
        }
      }
    }

    return outfits;
  }

  /**
   * Generate a conversational chat response for fashion questions
   */
  async generateChatResponse(
    message: string,
    conversationHistory: Array<{ role: string; content: string }>,
    userContext?: any,
  ): Promise<string> {
    const startTime = Date.now();

    try {
      const profile = userContext?.profile || {};

      const systemPrompt = `You are Elara, a friendly, knowledgeable, and stylish AI fashion assistant. You have expertise in fashion, styling, color theory, and personal style.

USER PROFILE:
- Gender: ${profile.gender || 'not specified'}
- Primary Style: ${profile.primaryStyle || 'versatile'}
- Style Influences: ${profile.selectedStyles?.join(', ') || 'open to all styles'}
- Budget Range: $${profile.priceRange?.min || 0} - $${profile.priceRange?.max || 'unlimited'}

GUIDELINES:
- Be warm, helpful, and enthusiastic about fashion
- Give specific, actionable advice when asked fashion questions
- Use your knowledge of color theory, body types, and current trends
- Keep responses concise but informative (2-4 sentences for simple questions)
- If someone asks about styling or matching items, give concrete suggestions
- Mention that you can search for products or create outfits if relevant
- Never be condescending - assume the user wants genuine help

IMPORTANT: You're having a conversation. Be natural and personable, not robotic.`;

      // Format conversation history for Gemini
      const formattedHistory = conversationHistory.slice(-6).map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

      // Format system instruction as Content object for newer Gemini models
      const systemInstruction = {
        parts: [{ text: systemPrompt }],
      };

      const chat = this.chatModel.startChat({
        history: formattedHistory,
        systemInstruction: systemInstruction,
      });

      const result = await chat.sendMessage(message);
      const response = result.response.text();

      const duration = Date.now() - startTime;
      this.logger.log(`Generated chat response in ${duration}ms`);

      return response;
    } catch (error) {
      this.logger.error('Chat response generation failed', error);
      // Return a helpful fallback
      return "I'd love to help you with your fashion question! Could you tell me a bit more about what you're looking for? I can search for products, suggest outfits, or give styling advice.";
    }
  }
}
