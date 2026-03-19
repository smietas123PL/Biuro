import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMessageMock = vi.hoisted(() => vi.fn());
const startChatMock = vi.hoisted(() =>
  vi.fn(() => ({
    sendMessage: sendMessageMock,
  }))
);
const getGenerativeModelMock = vi.hoisted(() =>
  vi.fn(() => ({
    startChat: startChatMock,
  }))
);
const googleGenerativeAiConstructorMock = vi.hoisted(() =>
  vi.fn(() => ({
    getGenerativeModel: getGenerativeModelMock,
  }))
);

const envMock = vi.hoisted(() => ({
  GOOGLE_API_KEY: 'google-test-key',
}));

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock('@google/generative-ai', async () => {
  const actual = await vi.importActual<typeof import('@google/generative-ai')>('@google/generative-ai');
  return {
    ...actual,
    GoogleGenerativeAI: googleGenerativeAiConstructorMock,
  };
});

vi.mock('../src/env.js', () => ({
  env: envMock,
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: loggerMock,
}));

import { GeminiRuntime } from '../src/runtime/gemini.js';
import type { AgentContext } from '../src/types/agent.js';

function createContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    company_name: 'Biuro',
    company_mission: 'Build autonomous teams',
    agent_name: 'Nova',
    agent_role: 'Planner',
    agent_model: 'gemini-2.0-flash',
    goal_hierarchy: ['Reduce support load'],
    current_task: {
      title: 'Reduce support load',
      description: 'Propose the next step.',
    },
    history: [
      {
        role: 'user',
        content: 'How should we reduce support load?',
      },
    ],
    ...overrides,
  };
}

describe('GeminiRuntime', () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    startChatMock.mockClear();
    getGenerativeModelMock.mockClear();
    googleGenerativeAiConstructorMock.mockClear();
    loggerMock.error.mockReset();
    envMock.GOOGLE_API_KEY = 'google-test-key';
  });

  it('parses structured Gemini JSON output into agent actions', async () => {
    sendMessageMock.mockResolvedValue({
      response: Promise.resolve({
        text: () =>
          JSON.stringify({
            thought: 'I should use the tool first and then continue.',
            actions: [
              {
                type: 'use_tool',
                tool_name: 'web_search',
                params: { query: 'top customer support automation workflows' },
              },
              {
                type: 'continue',
                thought: 'I will evaluate the search findings next.',
              },
            ],
          }),
        usageMetadata: {
          promptTokenCount: 200,
          candidatesTokenCount: 40,
        },
      }),
    });

    const runtime = new GeminiRuntime();
    const response = await runtime.execute(createContext());

    expect(googleGenerativeAiConstructorMock).toHaveBeenCalledWith('google-test-key');
    expect(getGenerativeModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.0-flash',
        generationConfig: expect.objectContaining({
          responseMimeType: 'application/json',
        }),
      })
    );
    expect(response.actions).toEqual([
      {
        type: 'use_tool',
        tool_name: 'web_search',
        params: { query: 'top customer support automation workflows' },
      },
      {
        type: 'continue',
        thought: 'I will evaluate the search findings next.',
      },
    ]);
    expect(response.thought).toBe('I should use the tool first and then continue.');
  });

  it('falls back to continue when Gemini JSON is invalid', async () => {
    sendMessageMock.mockResolvedValue({
      response: Promise.resolve({
        text: () => 'still-thinking',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
        },
      }),
    });

    const runtime = new GeminiRuntime();
    const response = await runtime.execute(createContext());

    expect(response).toMatchObject({
      thought: 'still-thinking',
      actions: [{ type: 'continue', thought: 'still-thinking' }],
    });
  });
});
