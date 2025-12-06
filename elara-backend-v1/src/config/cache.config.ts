import { registerAs } from '@nestjs/config';

export default registerAs('cache', () => ({
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'elara:',
  },
  ttl: {
    weather: parseInt(
      process.env.CACHE_WEATHER_TTL || String(6 * 60 * 60),
      10,
    ), // 6 hours
    products: parseInt(
      process.env.CACHE_PRODUCTS_TTL || String(24 * 60 * 60),
      10,
    ), // 24 hours
    outfit: parseInt(process.env.CACHE_OUTFIT_TTL || String(1 * 60 * 60), 10), // 1 hour
    userProfile: parseInt(
      process.env.CACHE_USER_PROFILE_TTL || String(30 * 60),
      10,
    ), // 30 minutes
    llmResponse: parseInt(
      process.env.CACHE_LLM_RESPONSE_TTL || String(48 * 60 * 60),
      10,
    ), // 48 hours
    llmRerank: parseInt(
      process.env.CACHE_LLM_RERANK_TTL || String(48 * 60 * 60),
      10,
    ), // 48 hours
    verification: parseInt(
      process.env.CACHE_VERIFICATION_TTL || String(6 * 60 * 60),
      10,
    ), // 6 hours
    searchResults: parseInt(
      process.env.CACHE_SEARCH_TTL || String(3600),
      10,
    ), // 1 hour
    userContext: parseInt(
      process.env.CACHE_USER_CONTEXT_TTL || String(300),
      10,
    ), // 5 minutes
  },
  options: {
    enableCompression: process.env.REDIS_ENABLE_COMPRESSION !== 'false',
    maxRetriesPerRequest: parseInt(
      process.env.REDIS_MAX_RETRIES || '3',
      10,
    ),
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
  },
}));
