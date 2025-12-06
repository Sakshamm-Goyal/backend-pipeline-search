import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'product_feedback' })
export class ProductFeedback extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  productUrl!: string;

  @Prop({ enum: ['like', 'dislike'], required: true })
  feedback!: string;

  @Prop()
  reason!: string;

  @Prop({ type: Types.ObjectId, ref: 'Message' })
  messageId!: Types.ObjectId;

  createdAt!: Date;
}

export const ProductFeedbackSchema =
  SchemaFactory.createForClass(ProductFeedback);

// Indexes
ProductFeedbackSchema.index({ userId: 1, productUrl: 1 }, { unique: true });
ProductFeedbackSchema.index({ userId: 1, feedback: 1 });
