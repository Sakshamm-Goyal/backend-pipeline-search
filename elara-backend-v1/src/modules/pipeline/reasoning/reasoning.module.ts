import { Module, forwardRef } from '@nestjs/common';
import { FashionReasoningService } from './fashion-reasoning.service';
import { LLMModule } from '../infrastructure/llm/llm.module';

/**
 * Reasoning Module
 *
 * Provides LLM-based reasoning services for fashion decisions:
 * - Color pairing recommendations
 * - Outfit scoring with explanations
 * - Safety and cultural validation
 *
 * This module replaces hardcoded fashion logic with dynamic LLM reasoning,
 * enabling the system to handle infinite fashion combinations intelligently.
 */
@Module({
  imports: [
    forwardRef(() => LLMModule),
  ],
  providers: [
    FashionReasoningService,
  ],
  exports: [
    FashionReasoningService,
  ],
})
export class ReasoningModule {}
