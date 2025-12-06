/**
 * Chat Message DTOs
 *
 * Represents messages in the conversation flow between user and Elara.
 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: MessageMetadata;
}

export interface MessageMetadata {
  intent?: string;
  confidence?: number;
  agentUsed?: string;
  processingTime?: number;
  sources?: string[];
  error?: string;
}

export interface ConversationContext {
  conversationId?: string;
  userId: string;
  sessionId?: string;
  history: ChatMessage[];
  currentIntent?: string;
  awaitingClarification?: boolean;
  userContext?: any; // User preferences, style, etc.
  preferences?: Record<string, any>; // User preferences for this session

  // ENHANCED: Session-scoped constraints (e.g., "avoid black from now on")
  activeConstraints?: Array<{
    id: string;
    type: string;
    value: string;
    priority: number;
    source: string;
    addedAt: Date;
  }>;

  // ENHANCED: Aggregated session preferences for quick lookup
  sessionPreferences?: {
    avoidColors: string[];
    preferColors: string[];
    avoidBrands: string[];
    preferBrands: string[];
    avoidStyles: string[];
    preferStyles: string[];
    budgetLimit?: number;
  };

  // ENHANCED: Feedback history for learning
  feedbackHistory?: Array<{
    productUrl: string;
    feedback: 'like' | 'dislike';
    reason?: string;
    timestamp: Date;
  }>;

  metadata?: {
    startedAt?: Date;
    lastMessageAt?: Date;
    messageCount?: number;
    userProfile?: any;
    lastOutfits?: any[]; // Previously shown outfits for reference
    lastProducts?: any[]; // Previously shown products for reference
  };
}

export interface AgentResponse {
  message: string;
  type: ResponseType;
  data?: any;
  metadata?: {
    intent: string;
    confidence: number;
    agentUsed: string;
    processingTime: number;
    sources?: string[];
    isOffTopic?: boolean;
    [key: string]: any; // Allow additional metadata properties
  };
  suggestedActions?: SuggestedAction[];
}

export enum ResponseType {
  TEXT = 'text',
  PRODUCT_LIST = 'product_list',
  OUTFIT_RECOMMENDATIONS = 'outfit_recommendations',
  CLARIFICATION = 'clarification',
  ERROR = 'error',
}

export interface SuggestedAction {
  label: string;
  action: string;
  data?: any;
}

/**
 * Agent execution result
 */
export interface AgentResult {
  success: boolean;
  response: AgentResponse;
  conversationContext: ConversationContext;
  error?: string;
}
