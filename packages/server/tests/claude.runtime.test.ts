import { beforeEach, describe, expect, it, vi } from 'vitest';

const messagesCreateMock = vi.hoisted(() => vi.fn());
const anthropicConstructorMock = vi.hoisted(() =>
  vi.fn(() => ({
    messages: {
      create: messagesCreateMock,
    },
  }))
);

const envMock = vi.hoisted(() => ({
  ANTHROPIC_API_KEY: 'test-key',
  LLM_PRICING_OVERRIDES: undefined as string | undefined,
}));

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: anthropicConstructorMock,
}));

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: loggerMock,
}));

import { ClaudeRuntime } from '../src/runtime/claude.js';
import type { AgentContext } from '../src/types/agent.js';

function createContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    company_name: 'Biuro',
    company_mission: 'Build autonomous teams',
    agent_name: 'Ada',
    agent_role: 'Research Lead',
    agent_model: 'claude-sonnet-4-20250514',
    goal_hierarchy: ['Improve customer retention'],
    current_task: {
      title: 'Investigate churn',
      description: 'Find the main issue.',
    },
    history: [
      {
        role: 'user',
        content: 'Please investigate churn drivers.',
      },
    ],
    additional_context: 'AVAILABLE TOOLS:\n- web_search',
    knowledge_context: 'Recent knowledge goes here.',
    ...overrides,
  };
}

describe('ClaudeRuntime', () => {
  beforeEach(() => {
    messagesCreateMock.mockReset();
    anthropicConstructorMock.mockClear();
    loggerMock.error.mockReset();
    envMock.ANTHROPIC_API_KEY = 'test-key';
    envMock.LLM_PRICING_OVERRIDES = undefined;
  });

  it('maps Anthropic tool_use blocks into agent actions', async () => {
    messagesCreateMock.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: 'I should split this into a research follow-up.',
        },
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'delegate',
          input: {
            to_role: 'analyst',
            name: 'Retention Cohort Analysis',
            description: 'Break churn down by cohort and segment.',
          },
        },
        {
          type: 'tool_use',
          id: 'toolu_2',
          name: 'continue',
          input: {
            thought: 'I will wait for the cohort analysis before concluding.',
          },
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 25,
      },
    });

    const runtime = new ClaudeRuntime();
    const response = await runtime.execute(createContext());

    expect(anthropicConstructorMock).toHaveBeenCalledWith({
      apiKey: 'test-key',
    });
    expect(messagesCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-20250514',
        tool_choice: {
          type: 'any',
          disable_parallel_tool_use: false,
        },
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'complete_task' }),
          expect.objectContaining({ name: 'delegate' }),
          expect.objectContaining({ name: 'use_tool' }),
        ]),
      })
    );
    expect(response.thought).toBe(
      'I should split this into a research follow-up.'
    );
    expect(response.actions).toEqual([
      {
        type: 'delegate',
        to_role: 'analyst',
        name: 'Retention Cohort Analysis',
        description: 'Break churn down by cohort and segment.',
      },
      {
        type: 'continue',
        thought: 'I will wait for the cohort analysis before concluding.',
      },
    ]);
    expect(response.usage).toEqual({
      input_tokens: 100,
      output_tokens: 25,
      cost_usd: 0.000675,
    });
  });

  it('uses model-specific pricing overrides when configured', async () => {
    envMock.LLM_PRICING_OVERRIDES = JSON.stringify({
      'claude-sonnet-4-20250514': {
        input_per_million_usd: 4,
        output_per_million_usd: 20,
      },
    });
    messagesCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: 'I should wait for teammate input.' }],
      usage: {
        input_tokens: 100,
        output_tokens: 25,
      },
    });

    const runtime = new ClaudeRuntime();
    const response = await runtime.execute(createContext());

    expect(response.usage).toEqual({
      input_tokens: 100,
      output_tokens: 25,
      cost_usd: 0.0009,
    });
  });

  it('falls back to continue when Claude returns no tool_use blocks', async () => {
    messagesCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: 'I am still investigating.' }],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
      },
    });

    const runtime = new ClaudeRuntime();
    const response = await runtime.execute(createContext());

    expect(response).toMatchObject({
      thought: 'I am still investigating.',
      actions: [
        {
          type: 'continue',
          thought: 'I am still investigating.',
        },
      ],
    });
  });
});
