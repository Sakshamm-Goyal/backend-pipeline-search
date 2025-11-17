import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

export interface ImageProcessingResult {
  original: Buffer;
  resized?: Buffer;
  thumbnail?: Buffer;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

@Injectable()
export class ImageProcessingService {
  private readonly logger = new Logger(ImageProcessingService.name);

  // Standard dimensions
  private readonly MAX_WIDTH = 1200;
  private readonly MAX_HEIGHT = 1600;
  private readonly THUMBNAIL_SIZE = 300;

  /**
   * Process an uploaded image: resize and create thumbnail
   */
  async processImage(buffer: Buffer): Promise<ImageProcessingResult> {
    try {
      const image = sharp(buffer);
      const metadata = await image.metadata();

      this.logger.log(
        `Processing image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`,
      );

      const result: ImageProcessingResult = {
        original: buffer,
      };

      // Resize if image is too large
      if (
        metadata.width &&
        metadata.height &&
        (metadata.width > this.MAX_WIDTH || metadata.height > this.MAX_HEIGHT)
      ) {
        result.resized = await this.resizeImage(buffer, {
          width: this.MAX_WIDTH,
          height: this.MAX_HEIGHT,
        });
        this.logger.log('Image resized successfully');
      }

      // Create thumbnail
      result.thumbnail = await this.createThumbnail(buffer);
      this.logger.log('Thumbnail created successfully');

      return result;
    } catch (error) {
      this.logger.error(`Image processing failed: ${error}`);
      throw error;
    }
  }

  /**
   * Resize an image to fit within max dimensions while maintaining aspect ratio
   */
  async resizeImage(
    buffer: Buffer,
    dimensions: ImageDimensions,
  ): Promise<Buffer> {
    try {
      return await sharp(buffer)
        .resize(dimensions.width, dimensions.height, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();
    } catch (error) {
      this.logger.error(`Failed to resize image: ${error}`);
      throw error;
    }
  }

  /**
   * Create a square thumbnail
   */
  async createThumbnail(buffer: Buffer): Promise<Buffer> {
    try {
      return await sharp(buffer)
        .resize(this.THUMBNAIL_SIZE, this.THUMBNAIL_SIZE, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch (error) {
      this.logger.error(`Failed to create thumbnail: ${error}`);
      throw error;
    }
  }

  /**
   * Remove background from image (placeholder - will implement with AI later)
   * For now, just returns the original buffer
   */
  async removeBackground(buffer: Buffer): Promise<Buffer> {
    this.logger.warn('Background removal not yet implemented');
    // TODO: Integrate with background removal service (e.g., remove.bg API)
    return buffer;
  }

  /**
   * Extract dominant colors from image
   */
  async extractDominantColor(buffer: Buffer): Promise<string> {
    try {
      const { dominant } = await sharp(buffer).stats();
      const hex = this.rgbToHex(dominant.r, dominant.g, dominant.b);
      this.logger.log(`Extracted dominant color: ${hex}`);
      return hex;
    } catch (error) {
      this.logger.error(`Failed to extract dominant color: ${error}`);
      return '#000000';
    }
  }

  /**
   * Get image metadata
   */
  async getImageMetadata(buffer: Buffer): Promise<sharp.Metadata> {
    try {
      return await sharp(buffer).metadata();
    } catch (error) {
      this.logger.error(`Failed to get image metadata: ${error}`);
      throw error;
    }
  }

  /**
   * Validate if buffer is a valid image
   */
  async isValidImage(buffer: Buffer): Promise<boolean> {
    try {
      await sharp(buffer).metadata();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Convert RGB to hex color
   */
  private rgbToHex(r: number, g: number, b: number): string {
    return (
      '#' +
      [r, g, b]
        .map((x) => {
          const hex = Math.round(x).toString(16);
          return hex.length === 1 ? '0' + hex : hex;
        })
        .join('')
    );
  }
}
