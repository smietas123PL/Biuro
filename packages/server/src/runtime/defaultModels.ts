import { env } from '../env.js';

const fallbackGeminiModel = 'gemini-2.0-flash';
const unsupportedGeminiDefaults = new Set(['gemini-3.1-flash-lite']);

export const defaultModelsByRuntime = {
  claude: env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  openai: env.OPENAI_MODEL || 'gpt-4o',
  gemini:
    !env.GEMINI_MODEL || unsupportedGeminiDefaults.has(env.GEMINI_MODEL)
      ? fallbackGeminiModel
      : env.GEMINI_MODEL,
} as const;
