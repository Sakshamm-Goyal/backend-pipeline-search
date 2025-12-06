import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Observable, Subscriber } from 'rxjs';
import {
  IChatHandler,
  ChatChunk,
  ChatIntent,
  UserContext,
} from '../handler.interface';
import { ConversationContext } from '../../../pipeline/agents/dto/chat-message.dto';
import { SearchFilters } from '../../../pipeline/search/dto/search-query.dto';
import { ProductFeedback } from '../../domain/schemas/feedback.schema';
import {
  ConstraintStoreService,
  ConstraintType,
  ConstraintSource,
} from '../../../pipeline/context/services/constraint-store.service';
import { ClaudeService } from '../../../pipeline/infrastructure/llm/claude.service';

/**
 * Extracted preference from feedback
 */
interface ExtractedPreference {
  type: ConstraintType;
  value: string;
  confidence: number;
}

/**
 * Feedback Handler
 *
 * ENHANCED: Handles user feedback on products and outfits.
 * Now extracts preferences from feedback and updates session constraints.
 *
 * Examples:
 * - "I love this outfit!" → positive feedback
 * - "The shoes aren't my style" → extracts style preference
 * - "Too expensive for me" → extracts budget constraint
 * - "I don't like the black top" → extracts color avoidance
 * - "I prefer Zara" → extracts brand preference
 */
@Injectable()
export class FeedbackHandler implements IChatHandler {
  private readonly logger = new Logger(FeedbackHandler.name);

  constructor(
    @InjectModel(ProductFeedback.name)
    private feedbackModel: Model<ProductFeedback>,
    @Optional() private constraintStore?: ConstraintStoreService,
    @Optional() private claudeService?: ClaudeService,
  ) {}

  canHandle(intent: ChatIntent): boolean {
    return intent === ChatIntent.FEEDBACK;
  }

  handle(
    message: string,
    context: ConversationContext,
    filters?: SearchFilters,
    userContext?: UserContext,
  ): Observable<ChatChunk> {
    return new Observable((observer) => {
      this.processFeedback(message, context, userContext, observer);
    });
  }

  private async processFeedback(
    message: string,
    context: ConversationContext,
    userContext: UserContext | undefined,
    observer: Subscriber<ChatChunk>,
  ): Promise<void> {
    try {
      // Parse feedback sentiment
      const { sentiment, reason, productUrl } = this.parseFeedback(message, context);

      // Save feedback to database
      if (productUrl) {
        await this.feedbackModel.findOneAndUpdate(
          {
            userId: context.userId,
            productUrl,
          },
          {
            $set: {
              feedback: sentiment,
              reason,
              updatedAt: new Date(),
            },
          },
          { upsert: true, new: true },
        );

        this.logger.log(`Saved ${sentiment} feedback for ${context.userId}`);
      }

      // ENHANCED: Extract preferences from feedback and update constraints
      const extractedPreferences = await this.extractPreferencesFromFeedback(
        message,
        sentiment,
        reason,
      );

      // Add extracted constraints to session
      let constraintsAdded: string[] = [];
      if (this.constraintStore && extractedPreferences.length > 0 && context.activeConstraints) {
        for (const pref of extractedPreferences) {
          if (pref.confidence >= 0.7) {
            this.constraintStore.addConstraint(context.activeConstraints, {
              type: pref.type,
              value: pref.value,
              source: ConstraintSource.FEEDBACK,
              priority: Math.round(pref.confidence * 10),
            });
            constraintsAdded.push(`${pref.type}: ${pref.value}`);
          }
        }

        if (constraintsAdded.length > 0) {
          this.logger.log(`Added ${constraintsAdded.length} constraints from feedback: ${constraintsAdded.join(', ')}`);
        }
      }

      // Generate response based on sentiment and extracted preferences
      const response = this.generateFeedbackResponse(sentiment, reason, extractedPreferences);

      observer.next({
        type: 'text',
        text: response.message,
      });

      observer.next({
        type: 'data',
        data: {
          feedbackSaved: true,
          sentiment,
          suggestedActions: response.actions,
          extractedPreferences: extractedPreferences.filter(p => p.confidence >= 0.7),
          constraintsAdded,
        },
        done: true,
      });

      observer.complete();
    } catch (error) {
      this.logger.error(`Feedback processing failed: ${(error as Error).message}`);
      observer.next({
        type: 'text',
        text: "Thanks for your feedback! I'll keep that in mind.",
      });
      observer.next({
        type: 'data',
        data: { feedbackSaved: false },
        done: true,
      });
      observer.complete();
    }
  }

  /**
   * Extract preferences from feedback using pattern matching and LLM
   */
  private async extractPreferencesFromFeedback(
    message: string,
    sentiment: 'like' | 'dislike',
    reason?: string,
  ): Promise<ExtractedPreference[]> {
    const preferences: ExtractedPreference[] = [];
    const messageLower = message.toLowerCase();

    // First, try pattern-based extraction (fast, no LLM required)
    preferences.push(...this.patternBasedExtraction(messageLower, sentiment));

    // If we have Claude and the message seems to contain implicit preferences, use LLM
    if (this.claudeService && this.shouldUseLLMExtraction(messageLower, preferences)) {
      try {
        const llmPreferences = await this.llmBasedExtraction(message, sentiment, reason);
        // Merge with pattern-based, preferring higher confidence
        for (const llmPref of llmPreferences) {
          const existing = preferences.find(p => p.type === llmPref.type && p.value === llmPref.value);
          if (!existing) {
            preferences.push(llmPref);
          } else if (llmPref.confidence > existing.confidence) {
            existing.confidence = llmPref.confidence;
          }
        }
      } catch (error) {
        this.logger.debug(`LLM preference extraction failed: ${(error as Error).message}`);
      }
    }

    return preferences;
  }

  /**
   * Pattern-based preference extraction (fast, no LLM)
   */
  private patternBasedExtraction(message: string, sentiment: 'like' | 'dislike'): ExtractedPreference[] {
    const preferences: ExtractedPreference[] = [];

    // Color extraction
    const colorWords = new Set([
      'black', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'purple',
      'pink', 'brown', 'gray', 'grey', 'navy', 'beige', 'cream', 'burgundy',
    ]);

    // Pattern: "don't like the [color]" or "hate [color]" or "not a fan of [color]"
    const dislikeColorPatterns = [
      /(?:don't like|hate|dislike|not a fan of|can't stand)\s+(?:the\s+)?(\w+)/i,
      /(\w+)\s+(?:doesn't|isn't|won't)\s+(?:work|suit|look)/i,
      /too\s+(\w+)/i,
    ];

    for (const pattern of dislikeColorPatterns) {
      const match = message.match(pattern);
      if (match && match[1] && colorWords.has(match[1].toLowerCase())) {
        preferences.push({
          type: ConstraintType.AVOID_COLOR,
          value: match[1].toLowerCase(),
          confidence: 0.85,
        });
      }
    }

    // Pattern: "love the [color]" or "like [color]"
    if (sentiment === 'like') {
      const likeColorPatterns = [
        /(?:love|like|adore|prefer)\s+(?:the\s+)?(\w+)/i,
      ];

      for (const pattern of likeColorPatterns) {
        const match = message.match(pattern);
        if (match && match[1] && colorWords.has(match[1].toLowerCase())) {
          preferences.push({
            type: ConstraintType.PREFER_COLOR,
            value: match[1].toLowerCase(),
            confidence: 0.8,
          });
        }
      }
    }

    // Price extraction: "too expensive" or "too pricey"
    if (message.includes('expensive') || message.includes('pricey') || message.includes('costly')) {
      preferences.push({
        type: ConstraintType.BUDGET_LIMIT,
        value: 'lower', // Signal to use lower budget
        confidence: 0.75,
      });
    }

    // Style extraction
    const styleKeywords: Record<string, string[]> = {
      casual: ['casual', 'relaxed', 'everyday'],
      formal: ['formal', 'dressy', 'elegant'],
      sporty: ['sporty', 'athletic'],
      minimalist: ['minimal', 'minimalist', 'simple'],
    };

    for (const [style, keywords] of Object.entries(styleKeywords)) {
      if (keywords.some(kw => message.includes(kw))) {
        if (sentiment === 'dislike' || message.includes(`too ${style}`) || message.includes(`not ${style}`)) {
          preferences.push({
            type: ConstraintType.AVOID_STYLE,
            value: style,
            confidence: 0.75,
          });
        } else if (sentiment === 'like') {
          preferences.push({
            type: ConstraintType.PREFER_STYLE,
            value: style,
            confidence: 0.75,
          });
        }
      }
    }

    // Brand extraction
    const brandPatterns = [
      /(?:prefer|love|like)\s+(\w+(?:\s+\w+)?)\s+(?:brand)?/i,
      /(?:from|by)\s+(\w+(?:\s+\w+)?)/i,
    ];

    const knownBrands = new Set([
      'zara', 'uniqlo', 'h&m', 'hm', 'nike', 'adidas', 'gucci', 'prada',
      'nordstrom', 'asos', 'mango', 'gap', 'levis', 'calvin klein',
    ]);

    for (const pattern of brandPatterns) {
      const match = message.match(pattern);
      if (match && match[1]) {
        const brand = match[1].toLowerCase().trim();
        if (knownBrands.has(brand)) {
          preferences.push({
            type: sentiment === 'like' ? ConstraintType.PREFER_BRAND : ConstraintType.AVOID_BRAND,
            value: brand,
            confidence: 0.8,
          });
        }
      }
    }

    return preferences;
  }

  /**
   * Determine if we should use LLM for extraction
   */
  private shouldUseLLMExtraction(message: string, existingPrefs: ExtractedPreference[]): boolean {
    // Use LLM if message is long and we didn't extract much
    if (message.length > 50 && existingPrefs.length < 2) {
      return true;
    }

    // Use LLM if message contains implicit preference language
    const implicitPatterns = [
      /not really my/i,
      /something (more|less)/i,
      /doesn't (suit|match|work)/i,
      /looking for something/i,
      /would prefer/i,
    ];

    return implicitPatterns.some(p => p.test(message));
  }

  /**
   * LLM-based preference extraction
   */
  private async llmBasedExtraction(
    message: string,
    sentiment: 'like' | 'dislike',
    reason?: string,
  ): Promise<ExtractedPreference[]> {
    if (!this.claudeService) {
      return [];
    }

    const prompt = `Extract fashion preferences from this feedback:

Message: "${message}"
Sentiment: ${sentiment}
${reason ? `Reason: ${reason}` : ''}

Return a JSON array of preferences. Each preference should have:
- type: One of AVOID_COLOR, PREFER_COLOR, AVOID_STYLE, PREFER_STYLE, PREFER_BRAND, AVOID_BRAND, BUDGET_LIMIT
- value: The specific color, style, brand, or "lower"/"higher" for budget
- confidence: 0.0 to 1.0 indicating how confident you are

Example output:
[
  {"type": "AVOID_COLOR", "value": "black", "confidence": 0.9},
  {"type": "PREFER_STYLE", "value": "casual", "confidence": 0.7}
]

Only include preferences that are clearly implied by the message. Return empty array [] if no preferences can be extracted.`;

    const response = await this.claudeService.generateJSON(prompt);

    if (!Array.isArray(response)) {
      return [];
    }

    // Map and validate response
    return response
      .filter((p: any) => p.type && p.value && typeof p.confidence === 'number')
      .map((p: any) => ({
        type: this.mapToConstraintType(p.type),
        value: String(p.value).toLowerCase(),
        confidence: Math.min(1, Math.max(0, p.confidence)),
      }))
      .filter((p: ExtractedPreference) => p.type !== undefined);
  }

  /**
   * Map string to ConstraintType
   */
  private mapToConstraintType(type: string): ConstraintType {
    const typeMap: Record<string, ConstraintType> = {
      AVOID_COLOR: ConstraintType.AVOID_COLOR,
      PREFER_COLOR: ConstraintType.PREFER_COLOR,
      AVOID_STYLE: ConstraintType.AVOID_STYLE,
      PREFER_STYLE: ConstraintType.PREFER_STYLE,
      PREFER_BRAND: ConstraintType.PREFER_BRAND,
      AVOID_BRAND: ConstraintType.AVOID_BRAND,
      BUDGET_LIMIT: ConstraintType.BUDGET_LIMIT,
    };
    return typeMap[type.toUpperCase()];
  }

  private parseFeedback(
    message: string,
    context: ConversationContext,
  ): {
    sentiment: 'like' | 'dislike';
    reason?: string;
    productUrl?: string;
  } {
    const messageLower = message.toLowerCase();

    // Determine sentiment
    const positiveKeywords = [
      'love', 'like', 'perfect', 'great', 'amazing', 'beautiful',
      'gorgeous', 'stunning', 'yes', 'good', 'nice', 'awesome',
    ];
    const negativeKeywords = [
      'hate', 'dislike', "don't like", 'not my', 'ugly', 'bad',
      'terrible', 'no', 'wrong', 'too expensive', 'not right',
    ];

    let sentiment: 'like' | 'dislike' = 'like';
    if (negativeKeywords.some((kw) => messageLower.includes(kw))) {
      sentiment = 'dislike';
    } else if (!positiveKeywords.some((kw) => messageLower.includes(kw))) {
      // Default to like if neutral
      sentiment = 'like';
    }

    // Extract reason
    let reason: string | undefined;
    const reasonPatterns = [
      /because (.+)/i,
      /too (.+)/i,
      /not (.+) enough/i,
      /I prefer (.+)/i,
    ];

    for (const pattern of reasonPatterns) {
      const match = message.match(pattern);
      if (match) {
        reason = match[1].trim();
        break;
      }
    }

    // Try to get product URL from context (last shown product/outfit)
    let productUrl: string | undefined;
    const lastOutfits = context.metadata?.lastOutfits || [];
    if (lastOutfits.length > 0) {
      // Get the first item from the first outfit
      const firstOutfit = lastOutfits[0];
      if (firstOutfit?.items?.[0]?.url) {
        productUrl = firstOutfit.items[0].url;
      }
    }

    return { sentiment, reason, productUrl };
  }

  private generateFeedbackResponse(
    sentiment: 'like' | 'dislike',
    reason?: string,
    extractedPreferences?: ExtractedPreference[],
  ): {
    message: string;
    actions: Array<{ label: string; action: string }>;
  } {
    // Build a more personalized response based on extracted preferences
    const highConfidencePrefs = extractedPreferences?.filter(p => p.confidence >= 0.7) || [];

    if (sentiment === 'like') {
      let message = reason
        ? `I'm glad you like it! I'll remember that ${reason} works well for you.`
        : "Great choice! I'll remember this for future recommendations.";

      // Add acknowledgment of extracted preferences
      if (highConfidencePrefs.length > 0) {
        const prefSummary = highConfidencePrefs
          .map(p => {
            if (p.type === ConstraintType.PREFER_COLOR) return `${p.value} colors`;
            if (p.type === ConstraintType.PREFER_STYLE) return `${p.value} style`;
            if (p.type === ConstraintType.PREFER_BRAND) return p.value;
            return null;
          })
          .filter(Boolean)
          .join(', ');

        if (prefSummary) {
          message += ` I've noted your preference for ${prefSummary}.`;
        }
      }

      return {
        message,
        actions: [
          { label: 'Save to favorites', action: 'save_favorite' },
          { label: 'Find similar items', action: 'find_similar' },
          { label: 'Create outfit with this', action: 'create_outfit' },
        ],
      };
    }

    // Dislike sentiment
    let message = "Thanks for letting me know! ";

    // Build response based on extracted preferences
    const avoidColors = highConfidencePrefs.filter(p => p.type === ConstraintType.AVOID_COLOR).map(p => p.value);
    const avoidStyles = highConfidencePrefs.filter(p => p.type === ConstraintType.AVOID_STYLE).map(p => p.value);
    const budgetConcern = highConfidencePrefs.find(p => p.type === ConstraintType.BUDGET_LIMIT);

    if (avoidColors.length > 0) {
      message += `I'll avoid ${avoidColors.join(' and ')} in future suggestions. `;
    }
    if (avoidStyles.length > 0) {
      message += `I'll skip ${avoidStyles.join(' and ')} styles. `;
    }
    if (budgetConcern) {
      message += "I'll focus on more affordable options. ";
    }

    if (avoidColors.length === 0 && avoidStyles.length === 0 && !budgetConcern) {
      message = reason
        ? `Got it! I'll avoid ${reason} in future suggestions.`
        : "Thanks for letting me know! Let me find something better for you.";
    }

    message += "Would you like me to find something different?";

    return {
      message: message.trim(),
      actions: [
        { label: 'Show alternatives', action: 'show_alternatives' },
        { label: 'Refine search', action: 'refine_search' },
        { label: 'Try different style', action: 'new_search' },
      ],
    };
  }
}
