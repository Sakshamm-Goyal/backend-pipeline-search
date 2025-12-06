import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private redis: Redis;
  private isConnected = false;

  constructor(private config: ConfigService) {
    const redisUrl = this.config.get<string>('REDIS_URL') || 'redis://localhost:6379';

    this.redis = new Redis(redisUrl, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        this.logger.debug(`Redis retry attempt ${times}, delay: ${delay}ms`);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    this.redis.on('connect', () => {
      this.isConnected = true;
      this.logger.log('Connected to Redis');
    });

    this.redis.on('ready', () => {
      this.logger.log('Redis is ready');
    });

    this.redis.on('error', (error) => {
      this.isConnected = false;
      this.logger.error('Redis error:', (error as Error).message);
    });

    this.redis.on('close', () => {
      this.isConnected = false;
      this.logger.warn('Redis connection closed');
    });

    this.redis.on('reconnecting', () => {
      this.logger.log('Reconnecting to Redis...');
    });
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.isConnected) {
      this.logger.warn('Redis not connected, skipping get');
      return null;
    }

    try {
      const value = await this.redis.get(key);
      if (!value) return null;

      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error(`Failed to get key "${key}":`, (error as Error).message);
      return null;
    }
  }

  /**
   * Set a value in cache with optional TTL
   */
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    if (!this.isConnected) {
      this.logger.warn('Redis not connected, skipping set');
      return;
    }

    try {
      const serialized = JSON.stringify(value);

      if (ttlSeconds) {
        await this.redis.setex(key, ttlSeconds, serialized);
      } else {
        await this.redis.set(key, serialized);
      }

      this.logger.debug(`Cached key "${key}" (TTL: ${ttlSeconds || 'none'}s)`);
    } catch (error) {
      this.logger.error(`Failed to set key "${key}":`, (error as Error).message);
    }
  }

  /**
   * Delete a key from cache
   */
  async del(key: string): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.redis.del(key);
      this.logger.debug(`Deleted key "${key}"`);
    } catch (error) {
      this.logger.error(`Failed to delete key "${key}":`, (error as Error).message);
    }
  }

  /**
   * Delete multiple keys matching a pattern
   */
  async delPattern(pattern: string): Promise<number> {
    if (!this.isConnected) {
      return 0;
    }

    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length === 0) return 0;

      await this.redis.del(...keys);
      this.logger.debug(`Deleted ${keys.length} keys matching "${pattern}"`);
      return keys.length;
    } catch (error) {
      this.logger.error(`Failed to delete pattern "${pattern}":`, (error as Error).message);
      return 0;
    }
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error(`Failed to check existence of "${key}":`, (error as Error).message);
      return false;
    }
  }

  /**
   * Get TTL of a key in seconds
   */
  async ttl(key: string): Promise<number> {
    if (!this.isConnected) {
      return -2; // Key doesn't exist
    }

    try {
      return await this.redis.ttl(key);
    } catch (error) {
      this.logger.error(`Failed to get TTL for "${key}":`, (error as Error).message);
      return -2;
    }
  }

  /**
   * Increment a counter
   */
  async incr(key: string): Promise<number> {
    if (!this.isConnected) {
      return 0;
    }

    try {
      return await this.redis.incr(key);
    } catch (error) {
      this.logger.error(`Failed to increment "${key}":`, (error as Error).message);
      return 0;
    }
  }

  /**
   * Set value with expiration only if key doesn't exist
   */
  async setnx(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    if (!this.isConnected) {
      return false;
    }

    try {
      const serialized = JSON.stringify(value);

      if (ttlSeconds) {
        const result = await this.redis.set(key, serialized, 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      } else {
        const result = await this.redis.setnx(key, serialized);
        return result === 1;
      }
    } catch (error) {
      this.logger.error(`Failed to setnx "${key}":`, (error as Error).message);
      return false;
    }
  }

  /**
   * Get Redis info
   */
  async getInfo(): Promise<any> {
    if (!this.isConnected) {
      return { connected: false };
    }

    try {
      const info = await this.redis.info('stats');
      const dbSize = await this.redis.dbsize();

      return {
        connected: this.isConnected,
        dbSize,
        info,
      };
    } catch (error) {
      this.logger.error('Failed to get Redis info:', (error as Error).message);
      return { connected: false, error: (error as Error).message };
    }
  }

  /**
   * Flush all keys (dangerous, use carefully!)
   */
  async flushAll(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.redis.flushall();
      this.logger.warn('Flushed all Redis keys');
    } catch (error) {
      this.logger.error('Failed to flush Redis:', (error as Error).message);
    }
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
      this.logger.log('Redis connection closed');
    }
  }
}
