import { registerAs } from '@nestjs/config';

export default registerAs('llm', () => ({
  gemini: {
    apiKey: process.env.GOOGLE_AI_API_KEY,
    reasoningModel: process.env.GEMINI_REASONING_MODEL || 'gemini-3-pro-preview',
    fastModel: process.env.GEMINI_FAST_MODEL || 'gemini-2.0-flash',
    temperature: parseFloat(process.env.GEMINI_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.GEMINI_MAX_TOKENS || '4000', 10),
    timeout: parseInt(process.env.LLM_TIMEOUT_MS || '30000', 10),
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4.5',
    temperature: parseFloat(process.env.ANTHROPIC_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '4000', 10),
    timeout: parseInt(process.env.LLM_TIMEOUT_MS || '30000', 10),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    embeddingModel:
      process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    embeddingDimensions: parseInt(
      process.env.OPENAI_EMBEDDING_DIMENSIONS || '1536',
      10,
    ),
    timeout: parseInt(process.env.LLM_TIMEOUT_MS || '30000', 10),
  },
}));
