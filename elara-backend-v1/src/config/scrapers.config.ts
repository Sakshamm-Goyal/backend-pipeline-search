import { registerAs } from '@nestjs/config';

export default registerAs('scrapers', () => ({
  oxylabs: {
    username: process.env.OXYLABS_USERNAME,
    password: process.env.OXYLABS_PASSWORD,
    enabled: process.env.ENABLE_OXYLABS === 'true',
    endpoint: 'https://realtime.oxylabs.io/v1/queries',
    rateLimit: parseInt(process.env.OXYLABS_RATE_LIMIT || '10', 10),
    timeout: parseInt(process.env.SEARCH_TIMEOUT_MS || '8000', 10),
  },
  asos: {
    rapidApiKey: process.env.RAPIDAPI_KEY,
    enabled: process.env.ENABLE_ASOS !== 'false', // Enabled by default
    endpoint: 'https://www.asos.com/api/product/search/v2/',
    rateLimit: 0.5, // 1 request per 2 seconds
    timeout: parseInt(process.env.SEARCH_TIMEOUT_MS || '8000', 10),
  },
  brave: {
    apiKey: process.env.BRAVE_API_KEY,
    enabled: process.env.ENABLE_BRAVE !== 'false',
    endpoint: 'https://api.search.brave.com/res/v1/web/search',
    rateLimit: 1,
    timeout: parseInt(process.env.SEARCH_TIMEOUT_MS || '8000', 10),
  },
  walmart: {
    apiKey: process.env.WALMART_API_KEY,
    enabled: process.env.ENABLE_WALMART !== 'false',
    endpoint: 'https://developer.api.walmart.com/api-proxy/service/affil/product/v2/search',
    rateLimit: 5,
    timeout: parseInt(process.env.SEARCH_TIMEOUT_MS || '8000', 10),
  },
  target: {
    apiKey: process.env.TARGET_API_KEY,
    enabled: process.env.ENABLE_TARGET !== 'false',
    endpoint: 'https://api.target.com/products/v3/search',
    rateLimit: 5,
    timeout: parseInt(process.env.SEARCH_TIMEOUT_MS || '8000', 10),
  },
  claudeWeb: {
    // Uses anthropic config for API key
    enabled: process.env.ENABLE_CLAUDE_WEB_SEARCH === 'true',
    timeout: parseInt(process.env.SEARCH_TIMEOUT_MS || '8000', 10),
  },
  general: {
    maxConcurrentSearches: parseInt(
      process.env.MAX_CONCURRENT_SEARCHES || '10',
      10,
    ),
    searchBatchSize: parseInt(process.env.SEARCH_BATCH_SIZE || '10', 10),
    searchBatchDelay: parseInt(process.env.SEARCH_BATCH_DELAY_MS || '100', 10),
    defaultTimeout: parseInt(process.env.SEARCH_TIMEOUT_MS || '8000', 10),
  },
}));
