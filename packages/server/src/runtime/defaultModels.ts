import { env } from '../env.js';

export const defaultModelsByRuntime = {
  claude: env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  openai: env.OPENAI_MODEL || 'gpt-4o',
  gemini: env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
} as const;
