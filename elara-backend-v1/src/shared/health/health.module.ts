import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { SearchHealthIndicator } from './indicators/search.health';
import { LLMHealthIndicator } from './indicators/llm.health';
import { SearchModule } from '../../modules/pipeline/search/search.module';
import { EmbeddingsModule } from '../../modules/pipeline/embeddings/embeddings.module';

@Module({
  imports: [
    TerminusModule,
    ConfigModule,
    SearchModule,
    EmbeddingsModule,
  ],
  controllers: [HealthController],
  providers: [
    SearchHealthIndicator,
    LLMHealthIndicator,
  ],
  exports: [
    SearchHealthIndicator,
    LLMHealthIndicator,
  ],
})
export class HealthModule {}
