import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));
const getRuntimeMock = vi.hoisted(() => vi.fn());
const executeMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/runtime/registry.js', () => ({
  runtimeRegistry: {
    getRuntime: getRuntimeMock,
  },
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../src/env.js', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-key',
    OPENAI_API_KEY: 'test-openai-key',
    GOOGLE_API_KEY: '',
    LLM_ROUTER_ENABLED: true,
    LLM_ROUTER_FALLBACK_ORDER: ['claude', 'openai', 'gemini'],
    LOG_LEVEL: 'error',
  },
}));

import { planNaturalLanguageCommand } from '../src/services/nlCommandPlanner.js';

describe('nl command planner', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    getRuntimeMock.mockReset();
    executeMock.mockReset();
    getRuntimeMock.mockReturnValue({
      execute: executeMock,
    });
  });

  it('uses the LLM plan when the returned tool actions are valid', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'company-1',
            name: 'Acme Labs',
            mission: 'Ship safely',
            config: {
              llm_primary_runtime: 'claude',
              llm_fallback_order: ['openai', 'gemini'],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'agent-2',
            name: 'Ben',
            role: 'Operator',
            title: 'Delivery Manager',
            status: 'idle',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    executeMock.mockResolvedValue({
      thought: 'Create the task and take the user to the tasks view.',
      actions: [
        {
          type: 'use_tool',
          tool_name: 'create_task',
          params: {
            title: 'Prepare launch notes',
            assigned_to: 'agent-2',
          },
        },
        {
          type: 'use_tool',
          tool_name: 'navigate',
          params: {
            path: '/tasks',
          },
        },
      ],
    });

    const plan = await planNaturalLanguageCommand(
      {
        companyId: 'company-1',
        role: 'admin',
      },
      'create task Prepare launch notes and assign to Ben'
    );

    expect(getRuntimeMock).toHaveBeenCalledWith('claude', {
      fallbackOrder: ['openai'],
    });
    expect(plan).toMatchObject({
      source: 'llm',
      can_execute: true,
      planner: {
        mode: 'llm',
      },
      actions: [
        {
          type: 'api_request',
          endpoint: '/companies/company-1/tasks',
          body: {
            title: 'Prepare launch notes',
            assigned_to: 'agent-2',
          },
        },
        {
          type: 'navigate',
          path: '/tasks',
        },
      ],
    });
  });

  it('falls back to rules when the LLM returns an invalid plan', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'company-1',
            name: 'Acme Labs',
            mission: 'Ship safely',
            config: {
              llm_primary_runtime: 'claude',
              llm_fallback_order: ['openai', 'gemini'],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'agent-1',
            name: 'Ada',
            role: 'Research Lead',
            title: 'Lead Strategist',
            status: 'idle',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [],
      });

    executeMock.mockResolvedValue({
      thought: 'Pause an unknown agent.',
      actions: [
        {
          type: 'use_tool',
          tool_name: 'pause_agent',
          params: {
            agent_id: 'missing-agent',
          },
        },
      ],
    });

    const plan = await planNaturalLanguageCommand(
      {
        companyId: 'company-1',
        role: 'owner',
      },
      'pause Ada'
    );

    expect(plan).toMatchObject({
      source: 'rules',
      can_execute: true,
      planner: {
        mode: 'rules',
        fallback_reason: 'invalid_llm_plan',
      },
    });
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'api_request',
          endpoint: '/agents/agent-1/pause',
        }),
      ])
    );
  });
});
