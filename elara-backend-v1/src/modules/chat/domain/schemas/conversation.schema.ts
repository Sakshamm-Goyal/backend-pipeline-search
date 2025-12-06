import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'conversations' })
export class Conversation extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ default: 'active', enum: ['active', 'archived'] })
  status!: string;

  @Prop()
  summary!: string;

  @Prop({ type: Object })
  lastOutfits!: any[];

  @Prop({ type: Object })
  metadata!: Record<string, any>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// Indexes
ConversationSchema.index({ userId: 1, status: 1, createdAt: -1 });
