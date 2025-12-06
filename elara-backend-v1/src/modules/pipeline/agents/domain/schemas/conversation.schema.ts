import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

// Sub-document for chat messages
@Schema({ _id: false })
export class ChatMessage {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true, enum: ['user', 'assistant', 'system'] })
  role!: 'user' | 'assistant' | 'system';

  @Prop({ required: true })
  content!: string;

  @Prop({ required: true })
  timestamp!: Date;

  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);

// Sub-document for user context
@Schema({ _id: false })
export class UserContext {
  @Prop()
  gender?: string;

  @Prop()
  style?: string;

  @Prop()
  preferences?: string;

  @Prop({ type: [String], default: [] })
  budget?: string[];

  @Prop({ type: [String], default: [] })
  occasions?: string[];

  @Prop({ type: Object })
  other?: Record<string, any>;
}

const UserContextSchema = SchemaFactory.createForClass(UserContext);

// Sub-document for session constraints (e.g., "avoid black from now on")
@Schema({ _id: false })
export class SessionConstraint {
  @Prop({ required: true })
  id!: string;

  @Prop({
    required: true,
    enum: [
      'AVOID_COLOR',
      'PREFER_COLOR',
      'AVOID_STYLE',
      'PREFER_STYLE',
      'PREFER_BRAND',
      'AVOID_BRAND',
      'BUDGET_LIMIT',
      'SIZE',
      'MATERIAL_PREFERENCE',
    ],
  })
  type!: string;

  @Prop({ required: true })
  value!: string;

  @Prop({ required: true, default: 1 })
  priority!: number;

  @Prop({
    required: true,
    enum: ['user_explicit', 'inferred', 'feedback'],
    default: 'user_explicit',
  })
  source!: string;

  @Prop({ required: true })
  addedAt!: Date;
}

const SessionConstraintSchema = SchemaFactory.createForClass(SessionConstraint);

// Sub-document for session preferences (dynamic preferences learned during session)
@Schema({ _id: false })
export class SessionPreferences {
  @Prop({ type: [String], default: [] })
  avoidColors!: string[];

  @Prop({ type: [String], default: [] })
  preferColors!: string[];

  @Prop({ type: [String], default: [] })
  avoidBrands!: string[];

  @Prop({ type: [String], default: [] })
  preferBrands!: string[];

  @Prop({ type: [String], default: [] })
  avoidStyles!: string[];

  @Prop({ type: [String], default: [] })
  preferStyles!: string[];

  @Prop()
  budgetLimit?: number;

  @Prop()
  budgetCurrency?: string;
}

const SessionPreferencesSchema = SchemaFactory.createForClass(SessionPreferences);

// Sub-document for outfit item (used in lastOutfits)
@Schema({ _id: false })
export class OutfitItemSnapshot {
  @Prop({ required: true })
  slot!: string;

  @Prop({ required: true })
  name!: string;

  @Prop()
  productId?: string;

  @Prop()
  productUrl?: string;

  @Prop()
  imageUrl?: string;

  @Prop()
  price?: number;

  @Prop()
  brand?: string;

  @Prop()
  color?: string;

  @Prop({ default: false })
  isFromWardrobe!: boolean;

  @Prop()
  wardrobeItemId?: string;
}

const OutfitItemSnapshotSchema = SchemaFactory.createForClass(OutfitItemSnapshot);

// Sub-document for last generated outfits (for slot-level editing)
@Schema({ _id: false })
export class OutfitSnapshot {
  @Prop({ required: true })
  outfitId!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ type: [OutfitItemSnapshotSchema], default: [] })
  items!: OutfitItemSnapshot[];

  @Prop()
  totalPrice?: number;

  @Prop()
  score?: number;

  @Prop({ required: true })
  generatedAt!: Date;
}

const OutfitSnapshotSchema = SchemaFactory.createForClass(OutfitSnapshot);

// Sub-document for feedback history
@Schema({ _id: false })
export class FeedbackEntry {
  @Prop({ required: true })
  productUrl!: string;

  @Prop({ required: true, enum: ['like', 'dislike'] })
  feedback!: 'like' | 'dislike';

  @Prop()
  reason?: string;

  @Prop()
  extractedPreference?: string;

  @Prop({ required: true })
  timestamp!: Date;
}

const FeedbackEntrySchema = SchemaFactory.createForClass(FeedbackEntry);

// Sub-document for conversation metadata
@Schema({ _id: false })
export class ConversationMetadata {
  @Prop({ required: true })
  startedAt!: Date;

  @Prop({ required: true })
  lastMessageAt!: Date;

  @Prop({ required: true, default: 0 })
  messageCount!: number;

  @Prop()
  lastIntent?: string;

  @Prop()
  sessionId?: string;
}

const ConversationMetadataSchema = SchemaFactory.createForClass(ConversationMetadata);

@Schema({
  timestamps: true,
  collection: 'conversations',
  toJSON: {
    virtuals: true,
    transform: (doc, ret: any) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Conversation extends Document {
  @Prop({ required: true, unique: true, index: true })
  conversationId!: string; // UUID from chat orchestrator

  @Prop({ required: true, type: Types.ObjectId, ref: 'User', index: true })
  userId!: Types.ObjectId;

  @Prop()
  sessionId?: string;

  @Prop({ type: [ChatMessageSchema], default: [] })
  history!: ChatMessage[];

  @Prop()
  currentIntent?: string;

  @Prop({ type: UserContextSchema })
  userContext?: UserContext;

  @Prop({ type: ConversationMetadataSchema, required: true })
  metadata!: ConversationMetadata;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop()
  deletedAt?: Date;

  // Session constraints (e.g., "avoid black from now on")
  @Prop({ type: [SessionConstraintSchema], default: [] })
  activeConstraints!: SessionConstraint[];

  // Session preferences (aggregated from constraints for quick lookup)
  @Prop({ type: SessionPreferencesSchema })
  sessionPreferences?: SessionPreferences;

  // Last generated outfits (for slot-level editing like "change only the shoes")
  @Prop({ type: [OutfitSnapshotSchema], default: [] })
  lastOutfits!: OutfitSnapshot[];

  // Feedback history for this session
  @Prop({ type: [FeedbackEntrySchema], default: [] })
  feedbackHistory!: FeedbackEntry[];

  // Timestamps (automatically added by timestamps: true)
  createdAt!: Date;
  updatedAt!: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// Indexes for efficient querying
ConversationSchema.index({ conversationId: 1 }, { unique: true });
ConversationSchema.index({ userId: 1, isActive: 1 });
ConversationSchema.index({ userId: 1, 'metadata.lastMessageAt': -1 });
ConversationSchema.index({ createdAt: -1 });
ConversationSchema.index({ isActive: 1, deletedAt: 1 });

// TTL index for soft-deleted conversations (optional: delete after 30 days)
ConversationSchema.index(
  { deletedAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60, partialFilterExpression: { deletedAt: { $exists: true } } },
);
