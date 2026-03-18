import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));

const runtimeExecuteMock = vi.hoisted(() => vi.fn());
const getRuntimeMock = vi.hoisted(() => vi.fn(() => ({ execute: runtimeExecuteMock })));
const buildAgentContextMock = vi.hoisted(() => vi.fn());
const canUseToolMock = vi.hoisted(() => vi.fn());
const executeToolMock = vi.hoisted(() => vi.fn());
const evaluatePolicyMock = vi.hoisted(() => vi.fn());
const createApprovalRequestMock = vi.hoisted(() => vi.fn());
const checkSafetyMock = vi.hoisted(() => vi.fn());
const autoPauseAgentMock = vi.hoisted(() => vi.fn());
const broadcastMock = vi.hoisted(() => vi.fn());
const getWSHubMock = vi.hoisted(() => vi.fn(() => ({ broadcast: broadcastMock })));
const findRelatedMemoriesMock = vi.hoisted(() => vi.fn());
const storeMemoryMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/runtime/registry.js', () => ({
  runtimeRegistry: {
    getRuntime: getRuntimeMock,
  },
}));

vi.mock('../src/orchestrator/context.js', () => ({
  buildAgentContext: buildAgentContextMock,
}));

vi.mock('../src/tools/registry.js', () => ({
  canUseTool: canUseToolMock,
}));

vi.mock('../src/tools/executor.js', () => ({
  executeTool: executeToolMock,
}));

vi.mock('../src/governance/policies.js', () => ({
  evaluatePolicy: evaluatePolicyMock,
}));

vi.mock('../src/governance/approvals.js', () => ({
  createApprovalRequest: createApprovalRequestMock,
}));

vi.mock('../src/orchestrator/safety.js', () => ({
  checkSafety: checkSafetyMock,
  autoPauseAgent: autoPauseAgentMock,
}));

vi.mock('../src/ws.js', () => ({
  getWSHub: getWSHubMock,
}));

vi.mock('../src/orchestrator/memory.js', () => ({
  findRelatedMemories: findRelatedMemoriesMock,
  storeMemory: storeMemoryMock,
}));

import { applyAgentBudgetSpend, processAgentHeartbeat } from '../src/orchestrator/heartbeat.js';

describe('heartbeat integration flows', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    dbMock.transaction.mockReset();
    runtimeExecuteMock.mockReset();
    getRuntimeMock.mockClear();
    buildAgentContextMock.mockReset();
    canUseToolMock.mockReset();
    executeToolMock.mockReset();
    evaluatePolicyMock.mockReset();
    createApprovalRequestMock.mockReset();
    checkSafetyMock.mockReset();
    autoPauseAgentMock.mockReset();
    broadcastMock.mockReset();
    getWSHubMock.mockClear();
    findRelatedMemoriesMock.mockReset();
    storeMemoryMock.mockReset();
  });

  it('keeps budget updates atomic and reports a capped spend path', async () => {
    dbMock.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ spent_usd: 10, limit_usd: 10 }] });

    await expect(applyAgentBudgetSpend('agent-1', 4.25)).resolves.toEqual({
      applied: false,
      capped: true,
    });

    expect(dbMock.query).toHaveBeenCalledTimes(2);
    expect(String(dbMock.query.mock.calls[0]?.[0])).toContain('ON CONFLICT (agent_id, month) DO UPDATE');
    expect(String(dbMock.query.mock.calls[0]?.[0])).toContain('WHERE budgets.spent_usd + EXCLUDED.spent_usd <= budgets.limit_usd');
  });

  it('records capped budget metadata during a successful heartbeat', async () => {
    evaluatePolicyMock.mockImplementation(async (_companyId: string, type: string) => {
      if (type === 'rate_limit' || type === 'tool_restriction') {
        return { allowed: true, requires_approval: false };
      }
      return { allowed: true, requires_approval: false };
    });
    checkSafetyMock.mockResolvedValue({ ok: true });
    findRelatedMemoriesMock.mockResolvedValue([]);
    buildAgentContextMock.mockResolvedValue({
      company_name: 'QA Test Corp',
      company_mission: 'Ship reliable software',
      agent_name: 'Ada',
      agent_role: 'Researcher',
      goal_hierarchy: [],
      current_task: {
        title: 'Investigate churn',
        description: 'Look for the churn drivers.',
      },
      history: [],
    });
    runtimeExecuteMock.mockResolvedValue({
      thought: 'Done.',
      actions: [
        {
          type: 'continue',
          thought: 'All clear.',
        },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cost_usd: 4.25,
      },
    });
    dbMock.transaction.mockImplementation(async (fn: (client: { query: typeof dbMock.query }) => Promise<unknown>) =>
      fn({
        query: vi.fn().mockResolvedValue({
          rows: [
            {
              id: 'task-1',
              company_id: 'company-1',
              title: 'Investigate churn',
              description: 'Look for the churn drivers.',
            },
          ],
        }),
      } as never)
    );
    dbMock.query.mockImplementation(async (text: string) => {
      if (text.includes("UPDATE agents SET status = 'working'")) {
        return { rows: [{ id: 'agent-1', company_id: 'company-1' }] };
      }

      if (text.includes('SELECT * FROM budgets')) {
        return { rows: [{ spent_usd: 6, limit_usd: 10 }] };
      }

      if (text === 'SELECT runtime, name FROM agents WHERE id = $1') {
        return { rows: [{ runtime: 'openai', name: 'Ada' }] };
      }

      if (text === 'SELECT state FROM agent_sessions WHERE agent_id = $1 AND task_id = $2') {
        return { rows: [] };
      }

      if (text.includes('WITH seeded_budget AS')) {
        return { rows: [] };
      }

      if (text.startsWith('UPDATE budgets')) {
        return { rows: [{ spent_usd: 10, limit_usd: 10 }] };
      }

      return { rows: [] };
    });

    await processAgentHeartbeat('agent-1');

    const auditInsert = dbMock.query.mock.calls.find(([text]) =>
      String(text).includes('INSERT INTO audit_log')
    );
    const heartbeatInsert = dbMock.query.mock.calls.find(([text]) =>
      String(text).includes('INSERT INTO heartbeats (agent_id, task_id, status, duration_ms, cost_usd, details)')
    );

    expect(auditInsert).toBeTruthy();
    expect(heartbeatInsert).toBeTruthy();

    const auditDetails = JSON.parse(String(auditInsert?.[1]?.[3]));
    const heartbeatDetails = JSON.parse(String(heartbeatInsert?.[1]?.[4]));

    expect(auditDetails.budget_capped).toBe(true);
    expect(heartbeatDetails.budget_capped).toBe(true);
    expect(broadcastMock).toHaveBeenCalledWith('company-1', 'agent.working', expect.objectContaining({
      agentId: 'agent-1',
      taskId: 'task-1',
    }));
  });

  it('uses a single atomic checkout query when claiming the next task', async () => {
    const taskCheckoutQueryMock = vi.fn().mockResolvedValue({ rows: [] });

    evaluatePolicyMock.mockResolvedValue({
      allowed: true,
      requires_approval: false,
    });
    dbMock.transaction.mockImplementation(async (fn: (client: { query: typeof taskCheckoutQueryMock }) => Promise<unknown>) =>
      fn({
        query: taskCheckoutQueryMock,
      } as never)
    );
    dbMock.query.mockImplementation(async (text: string, params?: any[]) => {
      if (text.includes("UPDATE agents SET status = 'working'")) {
        return { rows: [{ id: 'agent-1', company_id: 'company-1' }] };
      }

      if (text.includes('WITH seeded_budget AS')) {
        return { rows: [] };
      }

      if (text.includes('INSERT INTO heartbeats')) {
        return { rows: [], rowCount: 1 };
      }

      if (text.includes("UPDATE agents SET status = 'idle'")) {
        expect(params).toEqual(['agent-1']);
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query in atomic checkout test: ${text}`);
    });

    await processAgentHeartbeat('agent-1');

    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
    expect(taskCheckoutQueryMock).toHaveBeenCalledTimes(1);
    expect(String(taskCheckoutQueryMock.mock.calls[0]?.[0])).toContain('UPDATE tasks');
    expect(String(taskCheckoutQueryMock.mock.calls[0]?.[0])).toContain("SET status = 'in_progress', locked_by = $1, locked_at = now()");
    expect(String(taskCheckoutQueryMock.mock.calls[0]?.[0])).toContain("status IN ('backlog', 'assigned')");
    expect(String(taskCheckoutQueryMock.mock.calls[0]?.[0])).toContain('FOR UPDATE SKIP LOCKED');
    expect(String(taskCheckoutQueryMock.mock.calls[0]?.[0])).toContain('RETURNING *');
    expect(taskCheckoutQueryMock.mock.calls[0]?.[1]).toEqual(['agent-1']);

    const heartbeatInsert = dbMock.query.mock.calls.find(([text]) =>
      String(text).includes('INSERT INTO heartbeats')
    );
    expect(heartbeatInsert?.[1]?.[1]).toBe('idle');
    expect(JSON.parse(String(heartbeatInsert?.[1]?.[3]))).toMatchObject({
      reason: 'no eligible tasks',
    });
  });
});
