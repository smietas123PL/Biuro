import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

afterEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

describe('mock runtime mode', () => {
  it(
    'provides a working runtime without external API keys',
    async () => {
      process.env.LLM_MOCK_MODE = 'true';
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

    const { runtimeRegistry } = await import('../src/runtime/registry.js');
    const response = await runtimeRegistry.getRuntime('gemini').execute({
      company_name: 'QA Test Corp',
      company_mission: 'Ship stable software',
      agent_name: 'Alice',
      agent_role: 'ceo',
      current_task: {
        title: 'Prepare sprint report',
        description: 'Summarize the latest delivery status.',
      },
      goal_hierarchy: ['Deliver Sprint 3'],
      history: [],
    });

      expect(response.thought).toContain('Mock runtime');
      expect(response.actions).toEqual([
        expect.objectContaining({
          type: 'complete_task',
        }),
      ]);
      expect(response.usage?.cost_usd).toBeGreaterThan(0);
      expect(response.routing?.selected_runtime).toBe('gemini');
    },
    15_000
  );
});
