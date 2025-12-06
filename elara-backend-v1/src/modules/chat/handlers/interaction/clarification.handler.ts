import { Injectable, Logger } from '@nestjs/common';
import { Observable, Subscriber } from 'rxjs';
import {
  IChatHandler,
  ChatChunk,
  ChatIntent,
  UserContext,
} from '../handler.interface';
import { ConversationContext } from '../../../pipeline/agents/dto/chat-message.dto';
import { SearchFilters } from '../../../pipeline/search/dto/search-query.dto';
import { GeminiService } from '../../../pipeline/infrastructure/llm/gemini.service';

/**
 * Clarification Handler
 *
 * Handles ambiguous or unclear requests by asking clarifying questions.
 * Uses Gemini to generate contextual questions.
 *
 * Examples:
 * - "Find me something nice" -> What occasion? What style?
 * - "I need clothes" -> What type? What budget?
 * - Ambiguous intent -> Generate targeted questions
 */
@Injectable()
export class ClarificationHandler implements IChatHandler {
  private readonly logger = new Logger(ClarificationHandler.name);

  constructor(private geminiService: GeminiService) {}

  canHandle(intent: ChatIntent): boolean {
    return (
      intent === ChatIntent.CLARIFY ||
      intent === ChatIntent.AMBIGUOUS
    );
  }

  handle(
    message: string,
    context: ConversationContext,
    filters?: SearchFilters,
    userContext?: UserContext,
  ): Observable<ChatChunk> {
    return new Observable((observer) => {
      this.generateClarification(message, context, filters, userContext, observer);
    });
  }

  private async generateClarification(
    message: string,
    context: ConversationContext,
    filters: SearchFilters | undefined,
    userContext: UserContext | undefined,
    observer: Subscriber<ChatChunk>,
  ): Promise<void> {
    try {
      // Determine what information is missing
      const missingFields = this.determineMissingFields(message, filters);

      // Generate clarifying questions
      const questions = await this.generateQuestions(
        message,
        missingFields,
        userContext,
      );

      // Build response
      const responseText = this.buildClarificationResponse(message, questions);

      observer.next({
        type: 'text',
        text: responseText,
      });

      observer.next({
        type: 'data',
        data: {
          clarification: true,
          questions,
          missingFields,
          suggestedOptions: this.getSuggestedOptions(missingFields),
        },
        done: true,
      });

      observer.complete();
    } catch (error) {
      this.logger.error(`Clarification generation failed: ${(error as Error).message}`);
      // Fallback to generic clarification
      observer.next({
        type: 'text',
        text: "I'd love to help! Could you tell me more about what you're looking for? For example, what occasion is this for, or what style do you prefer?",
      });
      observer.next({
        type: 'data',
        data: { clarification: true },
        done: true,
      });
      observer.complete();
    }
  }

  private determineMissingFields(
    message: string,
    filters?: SearchFilters,
  ): string[] {
    const missing: string[] = [];
    const messageLower = message.toLowerCase();

    // Check for occasion
    const occasionKeywords = ['wedding', 'work', 'casual', 'formal', 'party', 'date', 'interview', 'vacation'];
    if (!filters?.occasion && !occasionKeywords.some((kw) => messageLower.includes(kw))) {
      missing.push('occasion');
    }

    // Check for item type
    const itemKeywords = ['dress', 'shirt', 'pants', 'shoes', 'top', 'bottom', 'jacket', 'outfit'];
    if (!filters?.itemType && !itemKeywords.some((kw) => messageLower.includes(kw))) {
      missing.push('itemType');
    }

    // Check for style
    const styleKeywords = ['casual', 'formal', 'bohemian', 'minimalist', 'classic', 'trendy', 'edgy'];
    if (!filters?.style && !styleKeywords.some((kw) => messageLower.includes(kw))) {
      missing.push('style');
    }

    // Check for budget/price
    const priceKeywords = ['under', 'budget', '$', 'cheap', 'expensive', 'affordable'];
    if (!filters?.priceRange && !priceKeywords.some((kw) => messageLower.includes(kw))) {
      missing.push('budget');
    }

    return missing.slice(0, 3); // Max 3 questions
  }

  private async generateQuestions(
    message: string,
    missingFields: string[],
    userContext?: UserContext,
  ): Promise<string[]> {
    const questions: string[] = [];

    // Map missing fields to questions
    const questionMap: Record<string, string> = {
      occasion: "What occasion is this for? (casual day out, work, special event, date night, etc.)",
      itemType: "What type of clothing are you looking for? (a complete outfit, specific item like a dress or top, etc.)",
      style: "What style are you going for? (minimalist, bohemian, classic, trendy, etc.)",
      budget: "Do you have a budget in mind? (under $50, $50-100, $100-200, any budget)",
      color: "Any color preferences? Or colors you'd like to avoid?",
      brand: "Do you have any brand preferences?",
    };

    for (const field of missingFields) {
      if (questionMap[field]) {
        questions.push(questionMap[field]);
      }
    }

    // If no specific questions, add a generic one
    if (questions.length === 0) {
      questions.push("Could you tell me more about what you're looking for?");
    }

    return questions;
  }

  private buildClarificationResponse(message: string, questions: string[]): string {
    let response = "I'd love to help you find exactly what you're looking for! ";

    if (questions.length === 1) {
      response += questions[0];
    } else {
      response += "Let me ask a few quick questions:\n\n";
      questions.forEach((q, index) => {
        response += `${index + 1}. ${q}\n`;
      });
    }

    return response;
  }

  private getSuggestedOptions(missingFields: string[]): Record<string, string[]> {
    const options: Record<string, string[]> = {};

    const optionsMap: Record<string, string[]> = {
      occasion: ['Casual', 'Work', 'Date Night', 'Party', 'Wedding', 'Vacation'],
      itemType: ['Complete Outfit', 'Dress', 'Top', 'Bottom', 'Shoes', 'Accessories'],
      style: ['Minimalist', 'Classic', 'Trendy', 'Bohemian', 'Edgy', 'Preppy'],
      budget: ['Under $50', '$50-100', '$100-200', '$200-500', 'No limit'],
    };

    for (const field of missingFields) {
      if (optionsMap[field]) {
        options[field] = optionsMap[field];
      }
    }

    return options;
  }
}
