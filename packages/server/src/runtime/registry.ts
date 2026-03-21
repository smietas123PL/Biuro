import { IAgentRuntime } from '../types/agent.js';
import { ClaudeRuntime } from './claude.js';
import { OpenAIRuntime } from './openai.js';
import { GeminiRuntime } from './gemini.js';
import { MockRuntime } from './mock.js';
import { env } from '../env.js';
import { MultiProviderRuntimeRouter } from './router.js';
import type { RuntimeName } from './preferences.js';

class RuntimeRegistry {
  private runtimes: Map<RuntimeName, IAgentRuntime> = new Map();

  constructor() {
    if (env.LLM_MOCK_MODE) {
      const mockRuntime = new MockRuntime();
      this.runtimes.set('claude', mockRuntime);
      this.runtimes.set('openai', mockRuntime);
      this.runtimes.set('gemini', mockRuntime);
      return;
    }

    this.runtimes.set('claude', new ClaudeRuntime());
    this.runtimes.set('openai', new OpenAIRuntime());
    if (env.GOOGLE_API_KEY) {
      this.runtimes.set('gemini', new GeminiRuntime());
    }
  }

  getRuntime(
    name: string,
    options?: { fallbackOrder?: RuntimeName[] }
  ): IAgentRuntime {
    if (!this.runtimes.has(name as RuntimeName)) {
      if (this.runtimes.size === 0) {
        throw new Error('No runtimes available');
      }
    }

    return new MultiProviderRuntimeRouter(name, this.runtimes, options);
  }

  getDirectRuntime(name: RuntimeName): IAgentRuntime {
    const runtime = this.runtimes.get(name);
    if (!runtime) {
      throw new Error(`Runtime ${name} not available`);
    }

    return runtime;
  }

  getAvailableRuntimeNames(): RuntimeName[] {
    return Array.from(this.runtimes.keys());
  }
}

export const runtimeRegistry = new RuntimeRegistry();
