import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  SessionConstraint,
  SessionPreferences,
  OutfitSnapshot,
  FeedbackEntry,
} from '../../agents/domain/schemas/conversation.schema';

/**
 * Constraint types that can be applied during a session
 */
export enum ConstraintType {
  AVOID_COLOR = 'AVOID_COLOR',
  PREFER_COLOR = 'PREFER_COLOR',
  AVOID_STYLE = 'AVOID_STYLE',
  PREFER_STYLE = 'PREFER_STYLE',
  PREFER_BRAND = 'PREFER_BRAND',
  AVOID_BRAND = 'AVOID_BRAND',
  BUDGET_LIMIT = 'BUDGET_LIMIT',
  SIZE = 'SIZE',
  MATERIAL_PREFERENCE = 'MATERIAL_PREFERENCE',
}

/**
 * Source of the constraint
 */
export enum ConstraintSource {
  USER_EXPLICIT = 'user_explicit', // User directly stated (e.g., "avoid black")
  INFERRED = 'inferred', // System inferred from context
  FEEDBACK = 'feedback', // Extracted from feedback (e.g., "I don't like this")
}

/**
 * Input for adding a new constraint
 */
export interface AddConstraintInput {
  type: ConstraintType;
  value: string;
  source?: ConstraintSource;
  priority?: number;
}

/**
 * Extracted constraint from user message
 */
export interface ExtractedConstraint {
  type: ConstraintType;
  value: string;
  confidence: number;
}

/**
 * Constraint Store Service
 *
 * Manages session-scoped constraints for outfit generation.
 * Constraints persist within a conversation session but not across sessions.
 *
 * Examples of constraints:
 * - "avoid black from now on" → AVOID_COLOR: black
 * - "I prefer Zara" → PREFER_BRAND: Zara
 * - "keep it under $120" → BUDGET_LIMIT: 120
 * - "no shiny fabrics" → MATERIAL_PREFERENCE: avoid shiny
 */
@Injectable()
export class ConstraintStoreService {
  private readonly logger = new Logger(ConstraintStoreService.name);

  /**
   * Add a constraint to the session
   */
  addConstraint(
    activeConstraints: SessionConstraint[],
    input: AddConstraintInput,
  ): SessionConstraint[] {
    const newConstraint: SessionConstraint = {
      id: uuidv4(),
      type: input.type,
      value: input.value.toLowerCase().trim(),
      priority: input.priority ?? 1,
      source: input.source ?? ConstraintSource.USER_EXPLICIT,
      addedAt: new Date(),
    };

    // Check for duplicate or conflicting constraints
    const existingIndex = activeConstraints.findIndex(
      (c) => c.type === input.type && c.value.toLowerCase() === newConstraint.value,
    );

    if (existingIndex >= 0) {
      // Update existing constraint's priority and timestamp
      activeConstraints[existingIndex] = {
        ...activeConstraints[existingIndex],
        priority: Math.max(activeConstraints[existingIndex].priority, newConstraint.priority),
        addedAt: new Date(),
      };
      this.logger.debug(`Updated existing constraint: ${input.type}=${input.value}`);
    } else {
      activeConstraints.push(newConstraint);
      this.logger.log(`Added constraint: ${input.type}=${input.value}`);
    }

    return activeConstraints;
  }

  /**
   * Remove a constraint by ID
   */
  removeConstraint(activeConstraints: SessionConstraint[], constraintId: string): SessionConstraint[] {
    const index = activeConstraints.findIndex((c) => c.id === constraintId);
    if (index >= 0) {
      const removed = activeConstraints.splice(index, 1)[0];
      this.logger.log(`Removed constraint: ${removed.type}=${removed.value}`);
    }
    return activeConstraints;
  }

  /**
   * Remove constraints by type and value
   */
  removeConstraintByValue(
    activeConstraints: SessionConstraint[],
    type: ConstraintType,
    value: string,
  ): SessionConstraint[] {
    const normalizedValue = value.toLowerCase().trim();
    return activeConstraints.filter((c) => !(c.type === type && c.value === normalizedValue));
  }

  /**
   * Get all constraints of a specific type
   */
  getConstraintsByType(activeConstraints: SessionConstraint[], type: ConstraintType): SessionConstraint[] {
    return activeConstraints.filter((c) => c.type === type);
  }

  /**
   * Aggregate constraints into SessionPreferences for quick lookup
   */
  aggregateToPreferences(activeConstraints: SessionConstraint[]): SessionPreferences {
    const preferences: SessionPreferences = {
      avoidColors: [],
      preferColors: [],
      avoidBrands: [],
      preferBrands: [],
      avoidStyles: [],
      preferStyles: [],
    };

    for (const constraint of activeConstraints) {
      switch (constraint.type) {
        case ConstraintType.AVOID_COLOR:
          preferences.avoidColors.push(constraint.value);
          break;
        case ConstraintType.PREFER_COLOR:
          preferences.preferColors.push(constraint.value);
          break;
        case ConstraintType.AVOID_BRAND:
          preferences.avoidBrands.push(constraint.value);
          break;
        case ConstraintType.PREFER_BRAND:
          preferences.preferBrands.push(constraint.value);
          break;
        case ConstraintType.AVOID_STYLE:
          preferences.avoidStyles.push(constraint.value);
          break;
        case ConstraintType.PREFER_STYLE:
          preferences.preferStyles.push(constraint.value);
          break;
        case ConstraintType.BUDGET_LIMIT:
          const budget = parseFloat(constraint.value);
          if (!isNaN(budget)) {
            preferences.budgetLimit = budget;
          }
          break;
      }
    }

    return preferences;
  }

  /**
   * Extract constraints from a user message using pattern matching
   * This is a lightweight extraction - for complex cases, use LLM extraction
   */
  extractConstraintsFromMessage(message: string): ExtractedConstraint[] {
    const constraints: ExtractedConstraint[] = [];
    const messageLower = message.toLowerCase();

    // Pattern: "avoid [color] from now on" or "no [color]" or "don't like [color]"
    const avoidColorPatterns = [
      /avoid\s+(\w+)\s+(?:from now on|please|colors?)?/i,
      /no\s+(\w+)\s+(?:colors?|items?|clothes?)?/i,
      /(?:don't|do not|i hate)\s+(?:like\s+)?(\w+)\s+(?:colors?)?/i,
      /stay away from\s+(\w+)/i,
    ];

    const colorWords = new Set([
      'black', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'purple',
      'pink', 'brown', 'gray', 'grey', 'navy', 'beige', 'cream', 'burgundy',
      'maroon', 'olive', 'teal', 'coral', 'gold', 'silver', 'tan', 'khaki',
    ]);

    for (const pattern of avoidColorPatterns) {
      const match = messageLower.match(pattern);
      if (match && match[1] && colorWords.has(match[1])) {
        constraints.push({
          type: ConstraintType.AVOID_COLOR,
          value: match[1],
          confidence: 0.9,
        });
      }
    }

    // Pattern: "prefer [brand]" or "I like [brand]" or "from [brand]"
    const preferBrandPatterns = [
      /(?:i prefer|i like|love)\s+(\w+(?:\s+\w+)?)\s+(?:brand)?/i,
      /(?:only|prefer)\s+(?:from\s+)?(\w+(?:\s+\w+)?)/i,
    ];

    const knownBrands = new Set([
      'zara', 'uniqlo', 'h&m', 'hm', 'nike', 'adidas', 'gucci', 'prada',
      'nordstrom', 'asos', 'mango', 'gap', 'levis', 'calvin klein', 'tommy hilfiger',
    ]);

    for (const pattern of preferBrandPatterns) {
      const match = messageLower.match(pattern);
      if (match && match[1]) {
        const brand = match[1].toLowerCase().trim();
        if (knownBrands.has(brand)) {
          constraints.push({
            type: ConstraintType.PREFER_BRAND,
            value: brand,
            confidence: 0.8,
          });
        }
      }
    }

    // Pattern: "under $X" or "budget of $X" or "keep it under X"
    const budgetPatterns = [
      /(?:under|below|less than|max|maximum)\s*\$?\s*(\d+)/i,
      /budget\s*(?:of|is)?\s*\$?\s*(\d+)/i,
      /\$(\d+)\s*(?:max|total|budget)/i,
      /keep it under\s*\$?\s*(\d+)/i,
    ];

    for (const pattern of budgetPatterns) {
      const match = messageLower.match(pattern);
      if (match && match[1]) {
        constraints.push({
          type: ConstraintType.BUDGET_LIMIT,
          value: match[1],
          confidence: 0.95,
        });
        break; // Only take first budget match
      }
    }

    // Pattern: "no shiny" or "avoid shiny fabrics" or "nothing glossy"
    const materialPatterns = [
      /(?:no|avoid|nothing|don't like)\s+(shiny|glossy|satin|velvet|leather|silk)/i,
      /(?:prefer|like)\s+(cotton|linen|wool|denim)/i,
    ];

    for (const pattern of materialPatterns) {
      const match = messageLower.match(pattern);
      if (match && match[1]) {
        const isAvoid = /(?:no|avoid|nothing|don't)/.test(messageLower);
        constraints.push({
          type: isAvoid ? ConstraintType.AVOID_STYLE : ConstraintType.PREFER_STYLE,
          value: match[1],
          confidence: 0.85,
        });
      }
    }

    // Pattern: "minimal" or "no logos" or "plain"
    const stylePatterns = [
      /(?:prefer|like|want)\s+(minimal|minimalist|plain|simple)/i,
      /(?:no|avoid)\s+(logos?|prints?|patterns?|busy)/i,
    ];

    for (const pattern of stylePatterns) {
      const match = messageLower.match(pattern);
      if (match && match[1]) {
        const isAvoid = /(?:no|avoid)/.test(messageLower);
        constraints.push({
          type: isAvoid ? ConstraintType.AVOID_STYLE : ConstraintType.PREFER_STYLE,
          value: match[1],
          confidence: 0.8,
        });
      }
    }

    this.logger.debug(`Extracted ${constraints.length} constraints from message`);
    return constraints;
  }

  /**
   * Apply constraints to filter products
   */
  applyConstraintsToProducts<T extends { color?: string; brand?: string; price?: number; title?: string }>(
    products: T[],
    preferences: SessionPreferences,
  ): T[] {
    return products.filter((product) => {
      // Check color constraints
      if (preferences.avoidColors.length > 0 && product.color) {
        const productColor = product.color.toLowerCase();
        if (preferences.avoidColors.some((c) => productColor.includes(c))) {
          this.logger.debug(`Filtered out product due to avoided color: ${product.color}`);
          return false;
        }
      }

      // Check brand constraints
      if (preferences.avoidBrands.length > 0 && product.brand) {
        const productBrand = product.brand.toLowerCase();
        if (preferences.avoidBrands.some((b) => productBrand.includes(b))) {
          this.logger.debug(`Filtered out product due to avoided brand: ${product.brand}`);
          return false;
        }
      }

      // Check budget constraints
      if (preferences.budgetLimit && product.price) {
        if (product.price > preferences.budgetLimit) {
          this.logger.debug(`Filtered out product due to budget: $${product.price} > $${preferences.budgetLimit}`);
          return false;
        }
      }

      // Check style constraints (in title)
      if (preferences.avoidStyles.length > 0 && product.title) {
        const productTitle = product.title.toLowerCase();
        if (preferences.avoidStyles.some((s) => productTitle.includes(s))) {
          this.logger.debug(`Filtered out product due to avoided style: ${product.title}`);
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Boost preferred products in ranking
   */
  boostPreferredProducts<T extends { color?: string; brand?: string; title?: string; score?: number }>(
    products: T[],
    preferences: SessionPreferences,
    boostAmount: number = 10,
  ): T[] {
    return products.map((product) => {
      let boost = 0;

      // Boost for preferred colors
      if (preferences.preferColors.length > 0 && product.color) {
        const productColor = product.color.toLowerCase();
        if (preferences.preferColors.some((c) => productColor.includes(c))) {
          boost += boostAmount;
        }
      }

      // Boost for preferred brands
      if (preferences.preferBrands.length > 0 && product.brand) {
        const productBrand = product.brand.toLowerCase();
        if (preferences.preferBrands.some((b) => productBrand.includes(b))) {
          boost += boostAmount * 1.5; // Brands get extra boost
        }
      }

      // Boost for preferred styles
      if (preferences.preferStyles.length > 0 && product.title) {
        const productTitle = product.title.toLowerCase();
        if (preferences.preferStyles.some((s) => productTitle.includes(s))) {
          boost += boostAmount;
        }
      }

      if (boost > 0 && product.score !== undefined) {
        return { ...product, score: product.score + boost };
      }

      return product;
    });
  }

  /**
   * Store last generated outfits for slot-level editing
   */
  storeOutfits(lastOutfits: OutfitSnapshot[], newOutfits: OutfitSnapshot[]): OutfitSnapshot[] {
    // Keep only the most recent 3 outfit sets (9 outfits total max)
    const combined = [...newOutfits, ...lastOutfits];
    return combined.slice(0, 9);
  }

  /**
   * Get outfit by ID from last outfits
   */
  getOutfitById(lastOutfits: OutfitSnapshot[], outfitId: string): OutfitSnapshot | undefined {
    return lastOutfits.find((o) => o.outfitId === outfitId);
  }

  /**
   * Add feedback entry
   */
  addFeedback(feedbackHistory: FeedbackEntry[], entry: Omit<FeedbackEntry, 'timestamp'>): FeedbackEntry[] {
    const newEntry: FeedbackEntry = {
      ...entry,
      timestamp: new Date(),
    };

    // Check for existing feedback on same product
    const existingIndex = feedbackHistory.findIndex((f) => f.productUrl === entry.productUrl);
    if (existingIndex >= 0) {
      feedbackHistory[existingIndex] = newEntry;
    } else {
      feedbackHistory.push(newEntry);
    }

    // Keep only last 50 feedback entries
    if (feedbackHistory.length > 50) {
      feedbackHistory = feedbackHistory.slice(-50);
    }

    return feedbackHistory;
  }

  /**
   * Generate a summary of active constraints for logging/debugging
   */
  summarizeConstraints(activeConstraints: SessionConstraint[]): string {
    if (activeConstraints.length === 0) {
      return 'No active constraints';
    }

    const grouped: Record<string, string[]> = {};
    for (const c of activeConstraints) {
      if (!grouped[c.type]) {
        grouped[c.type] = [];
      }
      grouped[c.type].push(c.value);
    }

    return Object.entries(grouped)
      .map(([type, values]) => `${type}: [${values.join(', ')}]`)
      .join(' | ');
  }
}
