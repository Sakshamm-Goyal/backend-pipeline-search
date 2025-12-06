import { Observable } from 'rxjs';
import { ConversationContext } from '../../pipeline/agents/dto/chat-message.dto';
import { SearchFilters } from '../../pipeline/search/dto/search-query.dto';

/**
 * Chat Handler Interface
 *
 * All chat handlers must implement this interface.
 * Handlers are responsible for processing specific intents
 * and returning streaming responses.
 */
export interface IChatHandler {
  /**
   * Check if this handler can handle the given intent
   */
  canHandle(intent: ChatIntent): boolean;

  /**
   * Handle the message and return streaming response
   *
   * @param message - User's message
   * @param context - Conversation context with history
   * @param filters - Extracted search filters (if any)
   * @param userContext - User profile and preferences
   */
  handle(
    message: string,
    context: ConversationContext,
    filters?: SearchFilters,
    userContext?: UserContext,
  ): Observable<ChatChunk>;
}

/**
 * Chat response chunk for streaming
 */
export interface ChatChunk {
  /** Type of chunk: text for streaming text, data for structured data */
  type: 'text' | 'data' | 'status';

  /** Streaming text content */
  text?: string;

  /** Structured data (products, outfits, etc.) */
  data?: any;

  /** Status message for progress indicators */
  status?: string;

  /** Whether this is the final chunk */
  done?: boolean;
}

/**
 * Chat intents supported by the system
 */
export enum ChatIntent {
  // Search intents
  GENERAL_CHAT = 'general_chat',
  SINGLE_ITEM_SEARCH = 'single_item_search',
  COMPLETE_OUTFIT_SEARCH = 'complete_outfit_search',
  CONTEXTUAL_ITEM_SEARCH = 'contextual_item_search',

  // Interaction intents
  ITEM_REPLACEMENT = 'item_replacement',
  FEEDBACK = 'feedback',
  WARDROBE_SELECT = 'wardrobe_select',

  // Clarification intents
  CLARIFY = 'clarify',
  AMBIGUOUS = 'ambiguous',

  // Fashion advice (no products)
  FASHION_ADVICE = 'fashion_advice',

  // Off-topic handling
  OFF_TOPIC = 'off_topic',
}

/**
 * User context for personalization
 */
export interface UserContext {
  userId?: string;
  location?: string;
  profile?: {
    gender?: string;
    primaryStyle?: string;
    selectedStyles?: string[];
    colorPreferences?: string[];
    avoidColors?: string[];
    likedBrands?: string[];
    priceRange?: {
      min?: number;
      max?: number;
    };
    modestDressing?: boolean;
    location?: any;
  };
  wardrobe?: any[];
  recentSearches?: string[];
  feedback?: any[];
}

/**
 * Handler execution result
 */
export interface HandlerResult {
  success: boolean;
  chunks: ChatChunk[];
  error?: string;
}

/**
 * Intent classification result from LLM
 */
export interface IntentClassification {
  intent: ChatIntent;
  confidence: number;
  filters: SearchFilters;
  reasoning?: string;
  clarificationFields?: string[];
  needsClarification?: boolean;
}

/**
 * Handler metadata for registration
 */
export interface HandlerMetadata {
  name: string;
  intents: ChatIntent[];
  priority: number;
  description: string;
}

/**
 * Injection token for handlers array
 */
export const CHAT_HANDLERS = 'CHAT_HANDLERS';
