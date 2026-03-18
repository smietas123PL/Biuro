import { IAgentRuntime } from '../types/agent.js';
import { ClaudeRuntime } from './claude.js';
import { OpenAIRuntime } from './openai.js';
import { GeminiRuntime } from './gemini.js';
import { env } from '../env.js';

class RuntimeRegistry {
  private runtimes: Map<string, IAgentRuntime> = new Map();

  constructor() {
    this.runtimes.set('claude', new ClaudeRuntime());
    this.runtimes.set('openai', new OpenAIRuntime());
    if (env.GOOGLE_API_KEY) {
      this.runtimes.set('gemini', new GeminiRuntime());
    }
  }

  getRuntime(name: string): IAgentRuntime {
    const runtime = this.runtimes.get(name);
    if (!runtime) throw new Error(`Runtime ${name} not found`);
    return runtime;
  }
}

export const runtimeRegistry = new RuntimeRegistry();
