import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);

@Injectable()
export class StorageService {
  private storage: Storage | null = null;
  private bucketName: string = '';
  private readonly logger = new Logger(StorageService.name);
  private useLocalStorage: boolean = false;
  private localStoragePath: string = '';

  constructor(private configService: ConfigService) {
    const keyFilePath = this.configService.get<string>('GCP_KEY_FILE');
    const projectId = this.configService.get<string>('GCP_PROJECT_ID');
    this.bucketName = this.configService.get<string>('GCP_BUCKET_NAME') || '';

    // Check if GCS is properly configured
    if (!this.bucketName || !projectId || !keyFilePath) {
      this.useLocalStorage = true;
      this.localStoragePath = path.join(process.cwd(), 'uploads');
      this.logger.warn(
        'Google Cloud Storage not configured. Using local file storage.',
      );
      this.logger.log(`Local storage path: ${this.localStoragePath}`);

      // Create uploads directory if it doesn't exist
      if (!fs.existsSync(this.localStoragePath)) {
        fs.mkdirSync(this.localStoragePath, { recursive: true });
      }
    } else {
      this.storage = new Storage({
        projectId,
        keyFilename: keyFilePath,
      });
      this.logger.log(`Storage initialized with GCS bucket: ${this.bucketName}`);
    }
  }

  /**
   * Upload a file to Google Cloud Storage or local storage
   */
  async uploadFile(
    file: Express.Multer.File,
    destination: string,
  ): Promise<{ url: string; key: string }> {
    if (this.useLocalStorage) {
      return this.uploadFileLocally(file.buffer, destination, file.mimetype);
    }

    try {
      const bucket = this.storage!.bucket(this.bucketName);
      const blob = bucket.file(destination);
      const blobStream = blob.createWriteStream({
        resumable: false,
        metadata: {
          contentType: file.mimetype,
        },
      });

      return new Promise((resolve, reject) => {
        blobStream.on('error', (err) => {
          this.logger.error(`Upload error: ${err.message}`);
          reject(err);
        });

        blobStream.on('finish', async () => {
          // Make the file public
          await blob.makePublic();

          const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${destination}`;

          this.logger.log(`File uploaded successfully: ${destination}`);
          resolve({ url: publicUrl, key: destination });
        });

        blobStream.end(file.buffer);
      });
    } catch (error) {
      this.logger.error(`Failed to upload file: ${error}`);
      throw error;
    }
  }

  /**
   * Upload a buffer to Google Cloud Storage or local storage
   */
  async uploadBuffer(
    buffer: Buffer,
    destination: string,
    mimetype: string,
  ): Promise<{ url: string; key: string }> {
    if (this.useLocalStorage) {
      return this.uploadFileLocally(buffer, destination, mimetype);
    }

    try {
      const bucket = this.storage!.bucket(this.bucketName);
      const blob = bucket.file(destination);
      const blobStream = blob.createWriteStream({
        resumable: false,
        metadata: {
          contentType: mimetype,
        },
      });

      return new Promise((resolve, reject) => {
        blobStream.on('error', (err) => {
          this.logger.error(`Upload error: ${err.message}`);
          reject(err);
        });

        blobStream.on('finish', async () => {
          await blob.makePublic();

          const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${destination}`;

          this.logger.log(`Buffer uploaded successfully: ${destination}`);
          resolve({ url: publicUrl, key: destination });
        });

        blobStream.end(buffer);
      });
    } catch (error) {
      this.logger.error(`Failed to upload buffer: ${error}`);
      throw error;
    }
  }

  /**
   * Delete a file from Google Cloud Storage or local storage
   */
  async deleteFile(fileKey: string): Promise<void> {
    if (this.useLocalStorage) {
      try {
        const fullPath = path.join(this.localStoragePath, fileKey);
        await unlink(fullPath);
        this.logger.log(`File deleted successfully: ${fileKey}`);
      } catch (error) {
        this.logger.error(`Failed to delete file: ${error}`);
        throw error;
      }
      return;
    }

    try {
      const bucket = this.storage!.bucket(this.bucketName);
      await bucket.file(fileKey).delete();
      this.logger.log(`File deleted successfully: ${fileKey}`);
    } catch (error) {
      this.logger.error(`Failed to delete file: ${error}`);
      throw error;
    }
  }

  /**
   * Generate a signed URL for temporary access
   */
  async getSignedUrl(fileKey: string): Promise<string> {
    if (this.useLocalStorage) {
      // For local storage, return the direct URL
      return `http://localhost:${this.configService.get('PORT', 3000)}/uploads/${fileKey}`;
    }

    try {
      const expiration = this.configService.get<number>(
        'GCS_SIGNED_URL_EXPIRATION',
        3600,
      );

      const bucket = this.storage!.bucket(this.bucketName);
      const file = bucket.file(fileKey);

      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiration * 1000,
      });

      return url;
    } catch (error) {
      this.logger.error(`Failed to generate signed URL: ${error}`);
      throw error;
    }
  }

  /**
   * Check if a file exists in GCS or local storage
   */
  async fileExists(fileKey: string): Promise<boolean> {
    if (this.useLocalStorage) {
      try {
        const fullPath = path.join(this.localStoragePath, fileKey);
        return fs.existsSync(fullPath);
      } catch (error) {
        this.logger.error(`Failed to check file existence: ${error}`);
        return false;
      }
    }

    try {
      const bucket = this.storage!.bucket(this.bucketName);
      const [exists] = await bucket.file(fileKey).exists();
      return exists;
    } catch (error) {
      this.logger.error(`Failed to check file existence: ${error}`);
      return false;
    }
  }

  /**
   * Upload file to local file system (development fallback)
   */
  private async uploadFileLocally(
    buffer: Buffer,
    destination: string,
    mimetype: string,
  ): Promise<{ url: string; key: string }> {
    try {
      const fullPath = path.join(this.localStoragePath, destination);
      const dir = path.dirname(fullPath);

      // Ensure directory exists
      await mkdir(dir, { recursive: true });

      // Write file
      await writeFile(fullPath, buffer);

      // Generate local URL (accessible via static file serving)
      const url = `http://localhost:${this.configService.get('PORT', 3000)}/uploads/${destination}`;

      this.logger.log(`File saved locally: ${fullPath}`);
      return { url, key: destination };
    } catch (error) {
      this.logger.error(`Failed to save file locally: ${error}`);
      throw error;
    }
  }

  /**
   * Generate a unique file path for uploads
   */
  generateFilePath(
    userId: string,
    folder: string,
    filename: string,
  ): string {
    const timestamp = Date.now();
    const ext = path.extname(filename);
    const basename = path.basename(filename, ext);
    const sanitizedFilename = `${basename}-${timestamp}${ext}`;

    return `${folder}/${userId}/${sanitizedFilename}`;
  }
}
