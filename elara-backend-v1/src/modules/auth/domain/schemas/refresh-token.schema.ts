import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({
  timestamps: true,
  collection: 'refreshtokens',
})
export class RefreshToken extends Document {
  @Prop({ required: true })
  token!: string;

  @Prop({ required: true, type: Types.ObjectId, ref: 'User' })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ default: false })
  isRevoked!: boolean;

  @Prop()
  revokedAt?: Date;

  @Prop()
  revokedByIp?: string;

  @Prop()
  replacedByToken?: string;

  // Store IP and user agent for security
  @Prop()
  createdByIp?: string;

  @Prop()
  userAgent?: string;

  // Timestamps
  createdAt!: Date;
  updatedAt!: Date;
}

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);

// Indexes
RefreshTokenSchema.index({ token: 1 }, { unique: true });
RefreshTokenSchema.index({ userId: 1 });
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index for auto-cleanup
RefreshTokenSchema.index({ isRevoked: 1, expiresAt: 1 });
