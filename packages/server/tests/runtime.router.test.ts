import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = vi.hoisted(() => ({
  LLM_ROUTER_ENABLED: true,
  LLM_ROUTER_FALLBACK_ORDER: ['claude', 'openai', 'gemini'],
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: loggerMock,
}));

vi.mock('../src/observability/tracing.js', () => ({
  startActiveSpan: async (
    _name: string,
    _attributes: Record<string, unknown>,
    fn: (span: {
      setAttribute: (key: string, value: unknown) => void;
    }) => Promise<unknown>
  ) =>
    fn({
      setAttribute: () => undefined,
    }),
}));

import { MultiProviderRuntimeRouter } from '../src/runtime/router.js';
import type {
  AgentContext,
  AgentResponse,
  IAgentRuntime,
} from '../src/types/agent.js';

function createContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    company_name: 'QA Test Corp',
    company_mission: 'Ship reliable software',
    agent_name: 'Ada',
    agent_role: 'Researcher',
    agent_model: 'gpt-4o',
    goal_hierarchy: ['Investigate churn'],
    current_task: {
      title: 'Investigate churn',
      description: 'Find the driver.',
    },
    history: [],
    ...overrides,
  };
}

describe('multi-provider runtime router', () => {
  beforeEach(() => {
    loggerMock.info.mockReset();
    loggerMock.warn.mockReset();
    loggerMock.error.mockReset();
    envMock.LLM_ROUTER_ENABLED = true;
    envMock.LLM_ROUTER_FALLBACK_ORDER = ['claude', 'openai', 'gemini'];
  });

  it('uses the preferred runtime when it succeeds', async () => {
    const preferredExecute = vi
      .fn<IAgentRuntime['execute']>()
      .mockResolvedValue({
        thought: 'Done.',
        actions: [{ type: 'continue', thought: 'Next.' }],
      } satisfies AgentResponse);

    const router = new MultiProviderRuntimeRouter(
      'openai',
      new Map([['openai', { execute: preferredExecute }]])
    );

    const response = await router.execute(createContext());

    expect(preferredExecute).toHaveBeenCalledTimes(1);
    expect(response.routing).toEqual({
      selected_runtime: 'openai',
      selected_model: 'gpt-4o',
      attempts: [
        {
          runtime: 'openai',
          model: 'gpt-4o',
          status: 'success',
        },
      ],
    });
  });

  it('falls back to the next provider on retryable runtime failures', async () => {
    const openAiExecute = vi
      .fn<IAgentRuntime['execute']>()
      .mockRejectedValue(new Error('429 rate limit exceeded'));
    const claudeExecute = vi.fn<IAgentRuntime['execute']>().mockResolvedValue({
      thought: 'Recovered.',
      actions: [{ type: 'continue', thought: 'Working.' }],
    } satisfies AgentResponse);

    const router = new MultiProviderRuntimeRouter(
      'openai',
      new Map([
        ['claude', { execute: claudeExecute }],
        ['openai', { execute: openAiExecute }],
      ])
    );

    const response = await router.execute(createContext());

    expect(openAiExecute).toHaveBeenCalledTimes(1);
    expect(claudeExecute).toHaveBeenCalledTimes(1);
    expect(claudeExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_model: 'claude-sonnet-4-20250514',
      })
    );
    expect(response.routing).toEqual({
      selected_runtime: 'claude',
      selected_model: 'claude-sonnet-4-20250514',
      attempts: [
        {
          runtime: 'openai',
          model: 'gpt-4o',
          status: 'fallback',
          reason: '429 rate limit exceeded',
        },
        {
          runtime: 'claude',
          model: 'claude-sonnet-4-20250514',
          status: 'success',
        },
      ],
    });
  });

  it('does not fallback on non-retryable provider errors', async () => {
    const openAiExecute = vi
      .fn<IAgentRuntime['execute']>()
      .mockRejectedValue(new Error('invalid_api_key'));
    const claudeExecute = vi.fn<IAgentRuntime['execute']>().mockResolvedValue({
      thought: 'Recovered.',
      actions: [{ type: 'continue', thought: 'Working.' }],
    } satisfies AgentResponse);

    const router = new MultiProviderRuntimeRouter(
      'openai',
      new Map([
        ['claude', { execute: claudeExecute }],
        ['openai', { execute: openAiExecute }],
      ])
    );

    await expect(router.execute(createContext())).rejects.toThrow(
      'invalid_api_key'
    );
    expect(claudeExecute).not.toHaveBeenCalled();
  });

  it('uses an explicit fallback order override when provided', async () => {
    const openAiExecute = vi
      .fn<IAgentRuntime['execute']>()
      .mockRejectedValue(new Error('429 rate limit exceeded'));
    const geminiExecute = vi.fn<IAgentRuntime['execute']>().mockResolvedValue({
      thought: 'Recovered via Gemini.',
      actions: [{ type: 'continue', thought: 'Working.' }],
    } satisfies AgentResponse);
    const claudeExecute = vi.fn<IAgentRuntime['execute']>().mockResolvedValue({
      thought: 'Should not be used first.',
      actions: [{ type: 'continue', thought: 'Working.' }],
    } satisfies AgentResponse);

    const router = new MultiProviderRuntimeRouter(
      'openai',
      new Map([
        ['claude', { execute: claudeExecute }],
        ['gemini', { execute: geminiExecute }],
        ['openai', { execute: openAiExecute }],
      ]),
      {
        fallbackOrder: ['gemini', 'claude', 'openai'],
      }
    );

    const response = await router.execute(createContext());

    expect(openAiExecute).toHaveBeenCalledTimes(1);
    expect(geminiExecute).toHaveBeenCalledTimes(1);
    expect(claudeExecute).not.toHaveBeenCalled();
    expect(response.routing?.selected_runtime).toBe('gemini');
    expect(response.routing?.attempts).toEqual([
      {
        runtime: 'openai',
        model: 'gpt-4o',
        status: 'fallback',
        reason: '429 rate limit exceeded',
      },
      {
        runtime: 'gemini',
        model: 'gemini-2.0-flash',
        status: 'success',
      },
    ]);
  });
});
