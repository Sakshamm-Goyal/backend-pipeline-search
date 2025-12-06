import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';

// Services
import { ContextService } from './services/context.service';
import { WeatherService } from './services/weather.service';
import { EventIntelligenceService } from './services/event-intelligence.service';
import { ConstraintDerivationService } from './services/constraint-derivation.service';
import { ContextAwareSearchService } from './services/context-aware-search.service';
import { ConstraintStoreService } from './services/constraint-store.service';
import { ColorPairingService } from '../utilities/color-pairing.service';

// Dependencies
import { OnboardingModule } from '../../onboarding/onboarding.module';
import { WardrobeModule } from '../../wardrobe/wardrobe.module';
import { SearchModule } from '../search/search.module';

/**
 * Context Module
 *
 * Provides deterministic context services for outfit generation:
 * - Weather fetching and processing
 * - Event/occasion intelligence
 * - Style constraint derivation
 * - Context pack preparation
 * - Context-aware product search
 */
@Module({
  imports: [
    ConfigModule,
    HttpModule,
    OnboardingModule,
    WardrobeModule,
    forwardRef(() => SearchModule),
  ],
  providers: [
    ContextService,
    WeatherService,
    EventIntelligenceService,
    ConstraintDerivationService,
    ContextAwareSearchService,
    ConstraintStoreService,
    ColorPairingService,
  ],
  exports: [
    ContextService,
    WeatherService,
    EventIntelligenceService,
    ConstraintDerivationService,
    ContextAwareSearchService,
    ConstraintStoreService,
    ColorPairingService,
  ],
})
export class ContextModule {}
