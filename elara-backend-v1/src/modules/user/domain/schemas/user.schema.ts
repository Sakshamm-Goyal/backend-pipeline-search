import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { AuthProvider } from '../../../auth/domain/enums/auth-provider.enum';

// Sub-document for OAuth providers
@Schema({ _id: false })
export class OAuthProviderData {
  @Prop({ required: true, enum: AuthProvider })
  provider!: AuthProvider;

  @Prop({ required: true })
  providerId!: string;

  @Prop()
  email?: string;

  @Prop()
  displayName?: string;

  @Prop({ type: Object })
  accessToken?: Record<string, any>;

  @Prop()
  refreshToken?: string;

  @Prop()
  linkedAt!: Date;
}

const OAuthProviderSchema = SchemaFactory.createForClass(OAuthProviderData);

@Schema({
  timestamps: true,
  collection: 'users',
  toJSON: {
    virtuals: true,
    transform: (doc, ret: any) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      delete ret.password;
      delete ret.emailVerificationToken;
      delete ret.passwordResetToken;
      return ret;
    },
  },
})
export class User extends Document {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  // Password is optional for OAuth-only users
  @Prop({ required: false, select: false })
  password?: string;

  @Prop({ required: true })
  firstName!: string;

  @Prop({ required: true })
  lastName!: string;

  @Prop({ enum: ['admin', 'user', 'moderator'], default: 'user' })
  role!: string;

  @Prop({ default: true })
  isActive!: boolean;

  // Email verification
  @Prop({ default: false })
  emailVerified!: boolean;

  @Prop({ select: false })
  emailVerificationToken?: string;

  @Prop()
  emailVerifiedAt?: Date;

  // Password reset
  @Prop({ select: false })
  passwordResetToken?: string;

  @Prop()
  passwordResetExpires?: Date;

  // OAuth providers
  @Prop({ type: [OAuthProviderSchema], default: [] })
  providers!: OAuthProviderData[];

  // Profile
  @Prop()
  avatar?: string;

  @Prop()
  phoneNumber?: string;

  // Onboarding Status
  @Prop({
    type: {
      completed: { type: Boolean, default: false },
      currentStep: { type: Number, default: 0 }, // 0-9
      startedAt: { type: Date },
      completedAt: { type: Date },
    },
    default: { completed: false, currentStep: 0 },
  })
  onboardingStatus!: {
    completed: boolean;
    currentStep: number;
    startedAt?: Date;
    completedAt?: Date;
  };

  // Tracking
  @Prop()
  lastLoginAt?: Date;

  @Prop()
  lastLoginIp?: string;

  // Timestamps (automatically added by timestamps: true)
  createdAt!: Date;
  updatedAt!: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Indexes
// Note: email unique index is already defined via @Prop({ unique: true }) on line 49
UserSchema.index({ 'providers.provider': 1, 'providers.providerId': 1 });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ 'onboardingStatus.completed': 1 });

// Virtual for full name
UserSchema.virtual('fullName').get(function (this: User) {
  return `${this.firstName} ${this.lastName}`;
});
