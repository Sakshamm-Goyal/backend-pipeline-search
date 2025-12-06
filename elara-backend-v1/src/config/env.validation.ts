import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(6900),
  FRONTEND_URL: Joi.string().uri().default('http://localhost:3000'),
  CORS_ORIGINS: Joi.string().optional(),

  // Database
  MONGODB_URI: Joi.string().required(),

  // Redis Cache
  REDIS_URL: Joi.string().uri().optional(),
  REDIS_HOST: Joi.string().optional(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().optional().allow(''),

  // JWT
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),

  // OAuth - Google
  GOOGLE_CLIENT_ID: Joi.string().optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().optional(),
  GOOGLE_CALLBACK_URL: Joi.string().uri().optional(),

  // OAuth - Apple
  APPLE_CLIENT_ID: Joi.string().optional(),
  APPLE_TEAM_ID: Joi.string().optional(),
  APPLE_KEY_ID: Joi.string().optional(),
  APPLE_PRIVATE_KEY: Joi.string().optional(),
  APPLE_CALLBACK_URL: Joi.string().uri().optional(),

  // Email
  EMAIL_HOST: Joi.string().optional(),
  EMAIL_PORT: Joi.number().optional(),
  EMAIL_USER: Joi.string().optional(),
  EMAIL_PASSWORD: Joi.string().optional(),
  EMAIL_FROM: Joi.string().email().optional(),

  // Google Cloud Storage
  GCP_PROJECT_ID: Joi.string().optional(),
  GCP_BUCKET_NAME: Joi.string().optional(),
  GCP_KEY_FILE: Joi.string().optional(),
  GCS_SIGNED_URL_EXPIRATION: Joi.number().default(3600),

  // LLM APIs
  GEMINI_API_KEY: Joi.string().optional(),
  OPENAI_API_KEY: Joi.string().optional(),
  ANTHROPIC_API_KEY: Joi.string().optional(),

  // Search APIs
  OXYLABS_USERNAME: Joi.string().optional(),
  OXYLABS_PASSWORD: Joi.string().optional(),
  SEARCHAPI_API_KEY: Joi.string().optional(),
  BRAVE_API_KEY: Joi.string().optional(),
  WALMART_API_KEY: Joi.string().optional(),
  TARGET_API_KEY: Joi.string().optional(),

  // Weather API
  OPENWEATHERMAP_API_KEY: Joi.string().optional(),

  // Feature Flags
  ENABLE_PLAYWRIGHT_SCRAPERS: Joi.boolean().default(false),
  ENABLE_EMBEDDING_PROCESSOR: Joi.boolean().default(true),
  ENABLE_SHOPSTYLE: Joi.boolean().default(false),

  // Rate Limiting
  THROTTLE_TTL: Joi.number().default(60000),
  THROTTLE_LIMIT: Joi.number().default(100),
});
