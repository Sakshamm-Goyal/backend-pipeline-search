import { Injectable, Logger, Optional } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from '../../../modules/pipeline/embeddings/embedding.service';

/**
 * LLM Health Indicator
 *
 * Checks the health of LLM services (Gemini, OpenAI embeddings).
 * Reports which LLM providers are available.
 */
@Injectable()
export class LLMHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(LLMHealthIndicator.name);

  constructor(
    private configService: ConfigService,
    @Optional() private embeddingService: EmbeddingService,
  ) {
    super();
  }

  /**
   * Check if Gemini is configured
   */
  private isGeminiConfigured(): boolean {
    const apiKey = this.configService.get<string>('GOOGLE_AI_API_KEY');
    return !!apiKey;
  }

  /**
   * Check if LLM services are healthy
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const geminiAvailable = this.isGeminiConfigured();
      const embeddingsAvailable = this.embeddingService?.isAvailable() ?? false;

      // At least one LLM provider should be available
      const isHealthy = geminiAvailable || embeddingsAvailable;

      const details = {
        gemini: {
          available: geminiAvailable,
          model: geminiAvailable ? 'gemini-3-pro-preview' : null,
        },
        embeddings: {
          available: embeddingsAvailable,
          model: embeddingsAvailable ? 'text-embedding-3-small' : null,
          rateLimitStatus: embeddingsAvailable
            ? this.embeddingService.getRateLimitStatus()
            : null,
        },
      };

      if (isHealthy) {
        return this.getStatus(key, true, details);
      }

      throw new HealthCheckError(
        'No LLM providers available',
        this.getStatus(key, false, details),
      );
    } catch (error) {
      if (error instanceof HealthCheckError) {
        throw error;
      }

      this.logger.error(`LLM health check failed: ${(error as Error).message}`);
      throw new HealthCheckError(
        'LLM health check failed',
        this.getStatus(key, false, { error: (error as Error).message }),
      );
    }
  }

  /**
   * Get LLM provider status summary
   */
  getLLMStatus(): {
    healthy: boolean;
    providers: Array<{
      name: string;
      available: boolean;
      model?: string;
    }>;
  } {
    const geminiAvailable = this.isGeminiConfigured();
    const embeddingsAvailable = this.embeddingService?.isAvailable() ?? false;

    const providers = [
      {
        name: 'gemini',
        available: geminiAvailable,
        model: 'gemini-3-pro-preview',
      },
      {
        name: 'openai_embeddings',
        available: embeddingsAvailable,
        model: 'text-embedding-3-small',
      },
    ];

    return {
      healthy: providers.some((p) => p.available),
      providers,
    };
  }
}
