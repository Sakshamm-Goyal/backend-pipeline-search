import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { ChatIntent } from '../enums/intent.enum';

@Schema({ timestamps: true, collection: 'messages' })
export class Message extends Document {
  @Prop({
    type: Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  })
  conversationId!: Types.ObjectId;

  @Prop({ enum: ['user', 'assistant', 'system'], required: true })
  role!: string;

  @Prop({ required: true })
  content!: string;

  @Prop({ type: Object })
  data!: any;

  @Prop({ type: String, enum: Object.values(ChatIntent) })
  intent!: ChatIntent;

  createdAt!: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// Indexes
MessageSchema.index({ conversationId: 1, createdAt: 1 });
MessageSchema.index({ conversationId: 1, intent: 1 });
