import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

const searchMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/services/knowledge.js', () => ({
  KnowledgeService: {
    search: searchMock,
  },
}));

import { buildAgentContext } from '../src/orchestrator/context.js';

describe('buildAgentContext integration flows', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    searchMock.mockReset();
  });

  it('builds context from agent, task, recursive goals, messages and knowledge', async () => {
    dbMock.query.mockImplementation(async (text: string) => {
      if (text.includes('FROM agents a')) {
        return {
          rows: [
            {
              id: 'agent-1',
              company_id: 'company-1',
              name: 'Ada',
              role: 'Researcher',
              model: 'gpt-4o',
              system_prompt: 'Be precise.',
              company_name: 'QA Test Corp',
              company_mission: 'Ship reliable software',
            },
          ],
        };
      }

      if (text === 'SELECT * FROM tasks WHERE id = $1') {
        return {
          rows: [
            {
              id: 'task-1',
              title: 'Investigate churn',
              description: 'Look for the churn drivers.',
              goal_id: 'goal-2',
            },
          ],
        };
      }

      if (
        text.includes('FROM tools t') &&
        text.includes('JOIN agent_tools at')
      ) {
        return {
          rows: [
            {
              id: 'tool-1',
              name: 'web_search',
              type: 'builtin',
              description: 'Search public web results for current information.',
              config: {},
              agent_tool_config: {},
            },
            {
              id: 'tool-2',
              name: 'workspace_shell',
              type: 'bash',
              description: 'Run a safe shell command from the approved list.',
              config: { allowed_commands: ['ls', 'cat package.json'] },
              agent_tool_config: {
                allowed_commands: ['ls', 'cat package.json'],
              },
            },
          ],
        };
      }

      if (text.includes('WITH RECURSIVE goal_path')) {
        return {
          rows: [
            { title: 'Improve retention' },
            { title: 'Investigate churn' },
          ],
        };
      }

      if (text.includes('FROM messages')) {
        return {
          rows: [
            {
              from_agent: 'agent-1',
              content: 'I started the analysis.',
              metadata: { step: 1 },
            },
            {
              from_agent: null,
              content: 'Please focus on enterprise users.',
              metadata: null,
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${text}`);
    });

    searchMock.mockResolvedValue([
      {
        title: 'Support notes',
        content: 'Enterprise users churn after onboarding.',
        metadata: {},
      },
    ]);

    const context = await buildAgentContext('agent-1', 'task-1');

    expect(context.company_name).toBe('QA Test Corp');
    expect(context.goal_hierarchy).toEqual([
      'Improve retention',
      'Investigate churn',
    ]);
    expect(context.additional_context).toContain('AVAILABLE TOOLS:');
    expect(context.additional_context).toContain('- web_search [builtin]');
    expect(context.additional_context).toContain('tool_name":"web_search"');
    expect(context.additional_context).toContain(
      'Allowed commands: ls, cat package.json'
    );
    expect(context.history).toEqual([
      {
        role: 'user',
        content: 'Please focus on enterprise users.',
        metadata: null,
      },
      {
        role: 'assistant',
        content: 'I started the analysis.',
        metadata: { step: 1 },
      },
    ]);
    expect(context.knowledge_context).toContain('Support notes');
    expect(searchMock).toHaveBeenCalledWith(
      'company-1',
      'Look for the churn drivers.',
      5,
      {
        agentId: 'agent-1',
        taskId: 'task-1',
        consumer: 'agent_context',
      }
    );

    const goalQueries = dbMock.query.mock.calls.filter(([text]) =>
      String(text).includes('WITH RECURSIVE goal_path')
    );
    expect(goalQueries).toHaveLength(1);

    const legacyGoalQueries = dbMock.query.mock.calls.filter(([text]) =>
      String(text).includes('SELECT title, parent_id FROM goals WHERE id = $1')
    );
    expect(legacyGoalQueries).toHaveLength(0);
  });

  it('falls back to task title when description is missing', async () => {
    dbMock.query.mockImplementation(async (text: string) => {
      if (text.includes('FROM agents a')) {
        return {
          rows: [
            {
              id: 'agent-1',
              company_id: 'company-1',
              name: 'Ada',
              role: 'Researcher',
              model: null,
              system_prompt: null,
              company_name: 'QA Test Corp',
              company_mission: 'Ship reliable software',
            },
          ],
        };
      }

      if (text === 'SELECT * FROM tasks WHERE id = $1') {
        return {
          rows: [
            {
              id: 'task-1',
              title: 'Investigate churn',
              description: null,
              goal_id: null,
            },
          ],
        };
      }

      if (
        text.includes('FROM tools t') &&
        text.includes('JOIN agent_tools at')
      ) {
        return { rows: [] };
      }

      if (text.includes('FROM messages')) {
        return { rows: [] };
      }

      throw new Error(`Unexpected query: ${text}`);
    });

    searchMock.mockResolvedValue([]);

    await buildAgentContext('agent-1', 'task-1');

    expect(searchMock).toHaveBeenCalledWith(
      'company-1',
      'Investigate churn',
      5,
      {
        agentId: 'agent-1',
        taskId: 'task-1',
        consumer: 'agent_context',
      }
    );
  });
});
