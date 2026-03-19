import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatCompletionsCreateMock = vi.hoisted(() => vi.fn());
const openAiConstructorMock = vi.hoisted(() =>
  vi.fn(() => ({
    chat: {
      completions: {
        create: chatCompletionsCreateMock,
      },
    },
  }))
);

const envMock = vi.hoisted(() => ({
  OPENAI_API_KEY: 'test-key',
}));

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock('openai', () => ({
  default: openAiConstructorMock,
}));

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: loggerMock,
}));

import { OpenAIRuntime } from '../src/runtime/openai.js';
import type { AgentContext } from '../src/types/agent.js';

function createContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    company_name: 'Biuro',
    company_mission: 'Build autonomous teams',
    agent_name: 'Ava',
    agent_role: 'Operator',
    agent_model: 'gpt-4o',
    goal_hierarchy: ['Improve onboarding'],
    current_task: {
      title: 'Improve onboarding',
      description: 'Propose the next step.',
    },
    history: [
      {
        role: 'user',
        content: 'What should we do next?',
      },
    ],
    ...overrides,
  };
}

describe('OpenAIRuntime', () => {
  beforeEach(() => {
    chatCompletionsCreateMock.mockReset();
    openAiConstructorMock.mockClear();
    loggerMock.error.mockReset();
    envMock.OPENAI_API_KEY = 'test-key';
  });

  it('parses structured JSON output into agent actions', async () => {
    chatCompletionsCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              thought:
                'I should delegate user interviews and keep tracking progress.',
              actions: [
                {
                  type: 'delegate',
                  to_role: 'researcher',
                  name: 'Interview users',
                  description: 'Run five onboarding interviews.',
                },
                {
                  type: 'continue',
                  thought:
                    'I will synthesize the interview findings once they arrive.',
                },
              ],
            }),
          },
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
      },
    });

    const runtime = new OpenAIRuntime();
    const response = await runtime.execute(createContext());

    expect(openAiConstructorMock).toHaveBeenCalledWith({ apiKey: 'test-key' });
    expect(chatCompletionsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        response_format: expect.objectContaining({
          type: 'json_schema',
        }),
      })
    );
    expect(response.actions).toEqual([
      {
        type: 'delegate',
        to_role: 'researcher',
        name: 'Interview users',
        description: 'Run five onboarding interviews.',
      },
      {
        type: 'continue',
        thought: 'I will synthesize the interview findings once they arrive.',
      },
    ]);
    expect(response.thought).toBe(
      'I should delegate user interviews and keep tracking progress.'
    );
  });

  it('falls back to continue when structured JSON is invalid', async () => {
    chatCompletionsCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: 'not-json',
          },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
      },
    });

    const runtime = new OpenAIRuntime();
    const response = await runtime.execute(createContext());

    expect(response).toMatchObject({
      thought: 'not-json',
      actions: [{ type: 'continue', thought: 'not-json' }],
    });
  });
});
