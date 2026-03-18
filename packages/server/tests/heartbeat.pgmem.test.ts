import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgMemDb } from './support/pgmem.js';

const dbState = vi.hoisted(() => ({
  impl: null as null | {
    query: (text: string, params?: any[]) => Promise<any>;
    transaction: <T>(fn: (client: any) => Promise<T>) => Promise<T>;
  },
}));

const evaluatePolicyMock = vi.hoisted(() => vi.fn());
const checkSafetyMock = vi.hoisted(() => vi.fn());
const autoPauseAgentMock = vi.hoisted(() => vi.fn());
const getRuntimeMock = vi.hoisted(() => vi.fn());
const buildAgentContextMock = vi.hoisted(() => vi.fn());
const findRelatedMemoriesMock = vi.hoisted(() => vi.fn());
const storeMemoryMock = vi.hoisted(() => vi.fn());
const canUseToolMock = vi.hoisted(() => vi.fn());
const executeToolMock = vi.hoisted(() => vi.fn());
const createApprovalRequestMock = vi.hoisted(() => vi.fn());
const broadcastMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: {
    query: (text: string, params?: any[]) => dbState.impl!.query(text, params),
    transaction: <T>(fn: (client: any) => Promise<T>) => dbState.impl!.transaction(fn),
  },
}));

vi.mock('../src/governance/policies.js', () => ({
  evaluatePolicy: evaluatePolicyMock,
}));

vi.mock('../src/orchestrator/safety.js', () => ({
  checkSafety: checkSafetyMock,
  autoPauseAgent: autoPauseAgentMock,
}));

vi.mock('../src/runtime/registry.js', () => ({
  runtimeRegistry: {
    getRuntime: getRuntimeMock,
  },
}));

vi.mock('../src/orchestrator/context.js', () => ({
  buildAgentContext: buildAgentContextMock,
}));

vi.mock('../src/orchestrator/memory.js', () => ({
  findRelatedMemories: findRelatedMemoriesMock,
  storeMemory: storeMemoryMock,
}));

vi.mock('../src/tools/registry.js', () => ({
  canUseTool: canUseToolMock,
}));

vi.mock('../src/tools/executor.js', () => ({
  executeTool: executeToolMock,
}));

vi.mock('../src/governance/approvals.js', () => ({
  createApprovalRequest: createApprovalRequestMock,
}));

vi.mock('../src/ws.js', () => ({
  getWSHub: () => ({ broadcast: broadcastMock }),
}));

import { applyAgentBudgetSpend, processAgentHeartbeat } from '../src/orchestrator/heartbeat.js';

describe('heartbeat pg-mem scenarios', () => {
  let testDb: Awaited<ReturnType<typeof createPgMemDb>>;

  beforeEach(async () => {
    testDb = await createPgMemDb();
    dbState.impl = testDb;

    evaluatePolicyMock.mockReset();
    checkSafetyMock.mockReset();
    autoPauseAgentMock.mockReset();
    getRuntimeMock.mockReset();
    buildAgentContextMock.mockReset();
    findRelatedMemoriesMock.mockReset();
    storeMemoryMock.mockReset();
    canUseToolMock.mockReset();
    executeToolMock.mockReset();
    createApprovalRequestMock.mockReset();
    broadcastMock.mockReset();
  });

  afterEach(async () => {
    dbState.impl = null;
    await testDb.close();
  });

  it('seeds the monthly budget row and persists the first heartbeat spend', async () => {
    const companyId = '00000000-0000-0000-0000-000000000001';
    const agentId = '00000000-0000-0000-0000-000000000011';

    await testDb.query(
      `INSERT INTO companies (id, name, mission)
       VALUES ($1, 'QA Test Corp', 'Ship reliable software')`,
      [companyId]
    );
    await testDb.query(
      `INSERT INTO agents (id, company_id, name, role, runtime, status, monthly_budget_usd)
       VALUES ($1, $2, 'Ada', 'Researcher', 'openai', 'idle', 10.00)`,
      [agentId, companyId]
    );

    await expect(applyAgentBudgetSpend(agentId, 7)).resolves.toEqual({
      applied: true,
      capped: false,
    });

    const budgetRes = await testDb.query(
      `SELECT limit_usd::float AS limit_usd, spent_usd::float AS spent_usd
       FROM budgets
       WHERE agent_id = $1`,
      [agentId]
    );

    expect(budgetRes.rows).toHaveLength(1);
    expect(budgetRes.rows[0]).toEqual({
      limit_usd: 10,
      spent_usd: 7,
    });
  });

  it('records budget_exceeded heartbeat and leaves the agent idle when already over budget', async () => {
    const companyId = '00000000-0000-0000-0000-000000000002';
    const agentId = '00000000-0000-0000-0000-000000000022';

    evaluatePolicyMock.mockResolvedValue({
      allowed: true,
      requires_approval: false,
    });

    await testDb.query(
      `INSERT INTO companies (id, name, mission)
       VALUES ($1, 'QA Test Corp', 'Ship reliable software')`,
      [companyId]
    );
    await testDb.query(
      `INSERT INTO agents (id, company_id, name, role, runtime, status, monthly_budget_usd)
       VALUES ($1, $2, 'Ada', 'Researcher', 'openai', 'idle', 10.00)`,
      [agentId, companyId]
    );
    await testDb.query(
      `INSERT INTO budgets (agent_id, month, limit_usd, spent_usd)
       VALUES ($1, date_trunc('month', now())::date, 10.00, 10.00)`,
      [agentId]
    );

    await processAgentHeartbeat(agentId);

    const heartbeatRes = await testDb.query(
      `SELECT status, details
       FROM heartbeats
       WHERE agent_id = $1`,
      [agentId]
    );
    const agentRes = await testDb.query(
      `SELECT status
       FROM agents
       WHERE id = $1`,
      [agentId]
    );

    expect(heartbeatRes.rows).toHaveLength(1);
    expect(heartbeatRes.rows[0].status).toBe('budget_exceeded');
    expect(heartbeatRes.rows[0].details).toMatchObject({
      reason: 'monthly budget exceeded',
    });
    expect(agentRes.rows[0].status).toBe('idle');
    expect(checkSafetyMock).not.toHaveBeenCalled();
    expect(broadcastMock).not.toHaveBeenCalled();
  });
});
