import { Module } from '@nestjs/common';
import { PersonalizationService } from './personalization.service';
import { AnalyticsModule } from '../analytics/analytics.module';

/**
 * Personalization Module
 *
 * Provides personalized ranking and recommendations.
 *
 * Features:
 * - Personalized product scoring
 * - User preference learning
 * - Category/brand affinity calculation
 * - Search term recommendations
 */
@Module({
  imports: [AnalyticsModule],
  providers: [PersonalizationService],
  exports: [PersonalizationService],
})
export class PersonalizationModule {}
