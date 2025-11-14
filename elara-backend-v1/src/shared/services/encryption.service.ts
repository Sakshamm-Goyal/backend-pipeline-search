import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

/**
 * Encryption Service for sensitive data (OAuth tokens, etc.)
 * Uses AES-256-GCM for encryption with authenticated encryption
 */
@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32; // 256 bits
  private readonly ivLength = 16; // 128 bits
  private readonly saltLength = 32;
  private readonly authTagLength = 16;

  /**
   * Get encryption key from environment variable
   * SECURITY: This must be a strong, randomly generated key stored securely
   */
  private async getKey(): Promise<Buffer> {
    const secret = process.env.ENCRYPTION_KEY;

    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'SECURITY ERROR: ENCRYPTION_KEY must be set in production',
        );
      }
      // Development fallback - NOT FOR PRODUCTION
      return Buffer.from('dev-encryption-key-32-chars!!!!');
    }

    // Derive key using scrypt for additional security
    const salt = Buffer.from('elara-encryption-salt-v1'); // Static salt for deterministic key
    const key = (await scryptAsync(secret, salt, this.keyLength)) as Buffer;

    return key;
  }

  /**
   * Encrypt sensitive data
   * Returns: base64-encoded string in format: salt:iv:authTag:encryptedData
   */
  async encrypt(plaintext: string): Promise<string> {
    if (!plaintext) {
      return '';
    }

    const key = await this.getKey();
    const iv = randomBytes(this.ivLength);
    const cipher = createCipheriv(this.algorithm, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Combine IV + authTag + encrypted data
    const combined = Buffer.concat([
      iv,
      authTag,
      Buffer.from(encrypted, 'hex'),
    ]);

    return combined.toString('base64');
  }

  /**
   * Decrypt sensitive data
   * Input: base64-encoded string in format: iv:authTag:encryptedData
   */
  async decrypt(ciphertext: string): Promise<string> {
    if (!ciphertext) {
      return '';
    }

    try {
      const key = await this.getKey();
      const combined = Buffer.from(ciphertext, 'base64');

      // Extract IV, authTag, and encrypted data
      const iv = combined.subarray(0, this.ivLength);
      const authTag = combined.subarray(
        this.ivLength,
        this.ivLength + this.authTagLength,
      );
      const encrypted = combined.subarray(this.ivLength + this.authTagLength);

      const decipher = createDecipheriv(this.algorithm, key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted.toString('hex'), 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error('Failed to decrypt data - possibly corrupted or wrong key');
    }
  }

  /**
   * Encrypt multiple fields in an object
   */
  async encryptFields<T extends Record<string, any>>(
    obj: T,
    fields: (keyof T)[],
  ): Promise<T> {
    const result = { ...obj };

    for (const field of fields) {
      if (result[field]) {
        (result[field] as any) = await this.encrypt(String(result[field]));
      }
    }

    return result;
  }

  /**
   * Decrypt multiple fields in an object
   */
  async decryptFields<T extends Record<string, any>>(
    obj: T,
    fields: (keyof T)[],
  ): Promise<T> {
    const result = { ...obj };

    for (const field of fields) {
      if (result[field]) {
        (result[field] as any) = await this.decrypt(String(result[field]));
      }
    }

    return result;
  }
}
