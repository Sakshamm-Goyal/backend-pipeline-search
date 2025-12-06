import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Background Removal Service
 *
 * Removes backgrounds from wardrobe item images to create clean,
 * consistent images for the wardrobe gallery and outfit visualization.
 *
 * Supports multiple providers:
 * - remove.bg API (cloud)
 * - Replicate API (cloud, rembg model)
 * - Self-hosted rembg (local)
 *
 * Features:
 * - Multiple provider fallback
 * - Quality options (preview/full)
 * - Batch processing support
 * - Retry logic with backoff
 */

export interface BackgroundRemovalOptions {
  quality?: 'preview' | 'full'; // preview=faster/cheaper, full=high quality
  outputFormat?: 'png' | 'webp';
  maxWidth?: number;
  maxHeight?: number;
  cropMargin?: number; // pixels to add around detected subject
}

export interface BackgroundRemovalResult {
  success: boolean;
  imageBuffer?: Buffer;
  imageBase64?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  provider?: string;
  processingTimeMs?: number;
  error?: string;
  creditsUsed?: number;
}

export interface BatchRemovalResult {
  results: Array<{
    index: number;
    success: boolean;
    result?: BackgroundRemovalResult;
    error?: string;
  }>;
  totalProcessed: number;
  successCount: number;
  failureCount: number;
}

type Provider = 'removebg' | 'replicate' | 'local';

@Injectable()
export class BackgroundRemovalService {
  private readonly logger = new Logger(BackgroundRemovalService.name);

  // Provider API keys
  private readonly removeBgApiKey: string | undefined;
  private readonly replicateApiKey: string | undefined;
  private readonly localEndpoint: string | undefined;

  // Provider priority
  private readonly providerPriority: Provider[];

  constructor(private configService: ConfigService) {
    this.removeBgApiKey = this.configService.get<string>('REMOVE_BG_API_KEY');
    this.replicateApiKey = this.configService.get<string>('REPLICATE_API_KEY');
    this.localEndpoint = this.configService.get<string>(
      'REMBG_LOCAL_ENDPOINT',
    );

    // Set provider priority based on available keys
    this.providerPriority = this.determineProviderPriority();

    this.logger.log(
      `Background removal initialized. Providers: ${this.providerPriority.join(', ') || 'none'}`,
    );
  }

  /**
   * Determine available providers based on configuration
   */
  private determineProviderPriority(): Provider[] {
    const providers: Provider[] = [];

    // Prefer remove.bg for quality
    if (this.removeBgApiKey) {
      providers.push('removebg');
    }

    // Replicate as fallback
    if (this.replicateApiKey) {
      providers.push('replicate');
    }

    // Local endpoint as last resort
    if (this.localEndpoint) {
      providers.push('local');
    }

    return providers;
  }

  /**
   * Check if service is available
   */
  isAvailable(): boolean {
    return this.providerPriority.length > 0;
  }

  /**
   * Get available providers
   */
  getAvailableProviders(): Provider[] {
    return [...this.providerPriority];
  }

  /**
   * Remove background from an image URL
   */
  async removeBackgroundFromUrl(
    imageUrl: string,
    options: BackgroundRemovalOptions = {},
  ): Promise<BackgroundRemovalResult> {
    const startTime = Date.now();

    if (!this.isAvailable()) {
      return {
        success: false,
        error: 'No background removal provider configured',
      };
    }

    // Try each provider in order
    for (const provider of this.providerPriority) {
      try {
        const result = await this.tryProvider(provider, imageUrl, options);
        if (result.success) {
          result.processingTimeMs = Date.now() - startTime;
          result.provider = provider;
          this.logger.log(
            `Background removed using ${provider} in ${result.processingTimeMs}ms`,
          );
          return result;
        }
      } catch (error) {
        const err = error as Error;
        this.logger.warn(
          `Provider ${provider} failed: ${err.message}. Trying next...`,
        );
      }
    }

    return {
      success: false,
      error: 'All background removal providers failed',
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Remove background from a base64 encoded image
   */
  async removeBackgroundFromBase64(
    imageBase64: string,
    options: BackgroundRemovalOptions = {},
  ): Promise<BackgroundRemovalResult> {
    const startTime = Date.now();

    if (!this.isAvailable()) {
      return {
        success: false,
        error: 'No background removal provider configured',
      };
    }

    // Try each provider in order
    for (const provider of this.providerPriority) {
      try {
        const result = await this.tryProviderBase64(
          provider,
          imageBase64,
          options,
        );
        if (result.success) {
          result.processingTimeMs = Date.now() - startTime;
          result.provider = provider;
          return result;
        }
      } catch (error) {
        const err = error as Error;
        this.logger.warn(
          `Provider ${provider} failed: ${err.message}. Trying next...`,
        );
      }
    }

    return {
      success: false,
      error: 'All background removal providers failed',
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Process multiple images in batch
   */
  async removeBackgroundBatch(
    imageUrls: string[],
    options: BackgroundRemovalOptions = {},
    concurrency: number = 3,
  ): Promise<BatchRemovalResult> {
    const results: BatchRemovalResult['results'] = [];
    let successCount = 0;
    let failureCount = 0;

    // Process in batches for rate limiting
    for (let i = 0; i < imageUrls.length; i += concurrency) {
      const batch = imageUrls.slice(i, i + concurrency);
      const batchPromises = batch.map((url, batchIndex) =>
        this.removeBackgroundFromUrl(url, options)
          .then((result) => ({
            index: i + batchIndex,
            success: result.success,
            result,
          }))
          .catch((error) => ({
            index: i + batchIndex,
            success: false,
            error: (error as Error).message,
          })),
      );

      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        results.push(result);
        if (result.success) {
          successCount++;
        } else {
          failureCount++;
        }
      }

      // Small delay between batches for rate limiting
      if (i + concurrency < imageUrls.length) {
        await this.delay(500);
      }
    }

    return {
      results,
      totalProcessed: imageUrls.length,
      successCount,
      failureCount,
    };
  }

  /**
   * Try a specific provider with URL
   */
  private async tryProvider(
    provider: Provider,
    imageUrl: string,
    options: BackgroundRemovalOptions,
  ): Promise<BackgroundRemovalResult> {
    switch (provider) {
      case 'removebg':
        return this.removeWithRemoveBg(imageUrl, options);
      case 'replicate':
        return this.removeWithReplicate(imageUrl, options);
      case 'local':
        return this.removeWithLocal(imageUrl, options);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Try a specific provider with base64
   */
  private async tryProviderBase64(
    provider: Provider,
    imageBase64: string,
    options: BackgroundRemovalOptions,
  ): Promise<BackgroundRemovalResult> {
    switch (provider) {
      case 'removebg':
        return this.removeWithRemoveBgBase64(imageBase64, options);
      case 'replicate':
        return this.removeWithReplicateBase64(imageBase64, options);
      case 'local':
        return this.removeWithLocalBase64(imageBase64, options);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Remove background using remove.bg API
   */
  private async removeWithRemoveBg(
    imageUrl: string,
    options: BackgroundRemovalOptions,
  ): Promise<BackgroundRemovalResult> {
    if (!this.removeBgApiKey) {
      throw new Error('remove.bg API key not configured');
    }

    const formData = new FormData();
    formData.append('image_url', imageUrl);
    formData.append('size', options.quality === 'full' ? 'full' : 'preview');
    formData.append('format', options.outputFormat || 'png');

    if (options.cropMargin !== undefined) {
      formData.append('crop_margin', options.cropMargin.toString());
    }

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': this.removeBgApiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`remove.bg API error: ${response.status} - ${errorText}`);
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const creditsUsed = parseInt(
      response.headers.get('X-Credits-Charged') || '1',
    );

    return {
      success: true,
      imageBuffer,
      imageBase64: imageBuffer.toString('base64'),
      mimeType: `image/${options.outputFormat || 'png'}`,
      creditsUsed,
    };
  }

  /**
   * Remove background using remove.bg with base64 input
   */
  private async removeWithRemoveBgBase64(
    imageBase64: string,
    options: BackgroundRemovalOptions,
  ): Promise<BackgroundRemovalResult> {
    if (!this.removeBgApiKey) {
      throw new Error('remove.bg API key not configured');
    }

    const formData = new FormData();
    formData.append('image_file_b64', imageBase64);
    formData.append('size', options.quality === 'full' ? 'full' : 'preview');
    formData.append('format', options.outputFormat || 'png');

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: {
        'X-Api-Key': this.removeBgApiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`remove.bg API error: ${response.status} - ${errorText}`);
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const creditsUsed = parseInt(
      response.headers.get('X-Credits-Charged') || '1',
    );

    return {
      success: true,
      imageBuffer,
      imageBase64: imageBuffer.toString('base64'),
      mimeType: `image/${options.outputFormat || 'png'}`,
      creditsUsed,
    };
  }

  /**
   * Remove background using Replicate (rembg model)
   */
  private async removeWithReplicate(
    imageUrl: string,
    options: BackgroundRemovalOptions,
  ): Promise<BackgroundRemovalResult> {
    if (!this.replicateApiKey) {
      throw new Error('Replicate API key not configured');
    }

    // Start prediction
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.replicateApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version:
          'fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003', // rembg model
        input: {
          image: imageUrl,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Replicate API error: ${response.status} - ${errorText}`,
      );
    }

    const prediction = await response.json();

    // Poll for completion
    const result = await this.pollReplicatePrediction(prediction.id);

    if (result.status === 'failed') {
      throw new Error(`Replicate prediction failed: ${result.error}`);
    }

    // Download the output image
    const outputUrl = result.output;
    const imageResponse = await fetch(outputUrl);
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    return {
      success: true,
      imageBuffer,
      imageBase64: imageBuffer.toString('base64'),
      mimeType: 'image/png',
    };
  }

  /**
   * Remove background using Replicate with base64 input
   */
  private async removeWithReplicateBase64(
    imageBase64: string,
    options: BackgroundRemovalOptions,
  ): Promise<BackgroundRemovalResult> {
    // Convert base64 to data URI for Replicate
    const dataUri = `data:image/png;base64,${imageBase64}`;
    return this.removeWithReplicate(dataUri, options);
  }

  /**
   * Poll Replicate prediction until complete
   */
  private async pollReplicatePrediction(
    predictionId: string,
    maxAttempts: number = 30,
    intervalMs: number = 1000,
  ): Promise<any> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await fetch(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          headers: {
            Authorization: `Token ${this.replicateApiKey}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to poll prediction: ${response.status}`);
      }

      const prediction = await response.json();

      if (prediction.status === 'succeeded' || prediction.status === 'failed') {
        return prediction;
      }

      await this.delay(intervalMs);
    }

    throw new Error('Prediction timed out');
  }

  /**
   * Remove background using local rembg endpoint
   */
  private async removeWithLocal(
    imageUrl: string,
    options: BackgroundRemovalOptions,
  ): Promise<BackgroundRemovalResult> {
    if (!this.localEndpoint) {
      throw new Error('Local rembg endpoint not configured');
    }

    const response = await fetch(`${this.localEndpoint}/remove`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_url: imageUrl,
        output_format: options.outputFormat || 'png',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Local rembg error: ${response.status} - ${errorText}`);
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());

    return {
      success: true,
      imageBuffer,
      imageBase64: imageBuffer.toString('base64'),
      mimeType: `image/${options.outputFormat || 'png'}`,
    };
  }

  /**
   * Remove background using local rembg with base64 input
   */
  private async removeWithLocalBase64(
    imageBase64: string,
    options: BackgroundRemovalOptions,
  ): Promise<BackgroundRemovalResult> {
    if (!this.localEndpoint) {
      throw new Error('Local rembg endpoint not configured');
    }

    const response = await fetch(`${this.localEndpoint}/remove`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image_base64: imageBase64,
        output_format: options.outputFormat || 'png',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Local rembg error: ${response.status} - ${errorText}`);
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());

    return {
      success: true,
      imageBuffer,
      imageBase64: imageBuffer.toString('base64'),
      mimeType: `image/${options.outputFormat || 'png'}`,
    };
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
