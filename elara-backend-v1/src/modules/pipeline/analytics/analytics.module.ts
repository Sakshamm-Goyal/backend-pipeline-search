import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserEvent, UserEventSchema } from './domain/schemas/user-event.schema';
import { UserEventRepository } from './infrastructure/persistence/user-event.repository';
import { AnalyticsService } from './analytics.service';

/**
 * Analytics Module
 *
 * Provides user behavior tracking and analytics for personalization.
 *
 * Features:
 * - Event tracking (search, product, wardrobe, chat)
 * - User behavior aggregation
 * - Engagement scoring
 * - GDPR compliance (anonymization, deletion)
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserEvent.name, schema: UserEventSchema },
    ]),
  ],
  providers: [UserEventRepository, AnalyticsService],
  exports: [AnalyticsService, UserEventRepository],
})
export class AnalyticsModule {}
