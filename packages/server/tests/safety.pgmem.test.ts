import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgMemDb } from './support/pgmem.js';

const dbState = vi.hoisted(() => ({
  impl: null as null | {
    query: (text: string, params?: any[]) => Promise<any>;
  },
}));

const deliverOutgoingWebhooksMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: {
    query: (text: string, params?: any[]) => dbState.impl!.query(text, params),
  },
}));

vi.mock('../src/services/outgoingWebhooks.js', () => ({
  deliverOutgoingWebhooks: deliverOutgoingWebhooksMock,
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

import { autoPauseAgent, checkSafety } from '../src/orchestrator/safety.js';

describe('safety pg-mem flows', () => {
  let testDb: Awaited<ReturnType<typeof createPgMemDb>>;

  beforeEach(async () => {
    testDb = await createPgMemDb();
    dbState.impl = testDb;
    deliverOutgoingWebhooksMock.mockReset();
    loggerWarnMock.mockReset();
  });

  afterEach(async () => {
    dbState.impl = null;
    await testDb.close();
  });

  it('blocks circular delegation chains', async () => {
    const companyId = '00000000-0000-0000-0000-000000000001';
    const taskA = '00000000-0000-0000-0000-000000000101';
    const taskB = '00000000-0000-0000-0000-000000000102';

    await testDb.query(`INSERT INTO companies (id, name) VALUES ($1, 'QA Test Corp')`, [companyId]);
    await testDb.query(
      `INSERT INTO tasks (id, company_id, parent_id, title, status)
       VALUES ($1, $2, $3, 'Task A', 'backlog')`,
      [taskA, companyId, taskB]
    );
    await testDb.query(
      `INSERT INTO tasks (id, company_id, parent_id, title, status)
       VALUES ($1, $2, $3, 'Task B', 'backlog')`,
      [taskB, companyId, taskA]
    );

    await expect(checkSafety('agent-1', taskA)).resolves.toEqual({
      ok: false,
      reason: 'Circular delegation detected',
    });
  });

  it('blocks message floods for a task and agent', async () => {
    const companyId = '00000000-0000-0000-0000-000000000002';
    const taskId = '00000000-0000-0000-0000-000000000201';
    const agentId = '00000000-0000-0000-0000-000000000202';

    await testDb.query(`INSERT INTO companies (id, name) VALUES ($1, 'QA Test Corp')`, [companyId]);
    await testDb.query(
      `INSERT INTO tasks (id, company_id, title, status)
       VALUES ($1, $2, 'Investigate churn', 'backlog')`,
      [taskId, companyId]
    );

    for (let index = 0; index < 11; index += 1) {
      await testDb.query(
        `INSERT INTO messages (id, company_id, task_id, from_agent, content, type)
         VALUES ($1, $2, $3, $4, $5, 'message')`,
        [
          `00000000-0000-0000-0000-0000000003${String(index + 1).padStart(2, '0')}`,
          companyId,
          taskId,
          agentId,
          `Message ${index + 1}`,
        ]
      );
    }

    await expect(checkSafety(agentId, taskId)).resolves.toEqual({
      ok: false,
      reason: 'Message flood detected',
    });
  });

  it('blocks agents that already hit the hard heartbeat safety cap', async () => {
    const companyId = '00000000-0000-0000-0000-000000000021';
    const taskId = '00000000-0000-0000-0000-000000000211';
    const agentId = '00000000-0000-0000-0000-000000000212';

    await testDb.query(`INSERT INTO companies (id, name) VALUES ($1, 'QA Test Corp')`, [companyId]);
    await testDb.query(
      `INSERT INTO tasks (id, company_id, title, status)
       VALUES ($1, $2, 'Investigate churn', 'backlog')`,
      [taskId, companyId]
    );

    for (let index = 0; index < 60; index += 1) {
      await testDb.query(
        `INSERT INTO heartbeats (id, agent_id, task_id, status, details)
         VALUES ($1, $2, $3, 'idle', '{}')`,
        [
          `10000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`,
          agentId,
          taskId,
        ]
      );
    }

    await expect(checkSafety(agentId, taskId)).resolves.toEqual({
      ok: false,
      reason: 'Heartbeat rate limit exceeded',
    });
  });

  it('blocks agents with too many recent heartbeat errors', async () => {
    const companyId = '00000000-0000-0000-0000-000000000003';
    const taskId = '00000000-0000-0000-0000-000000000301';
    const agentId = '00000000-0000-0000-0000-000000000302';

    await testDb.query(`INSERT INTO companies (id, name) VALUES ($1, 'QA Test Corp')`, [companyId]);
    await testDb.query(
      `INSERT INTO tasks (id, company_id, title, status)
       VALUES ($1, $2, 'Investigate churn', 'backlog')`,
      [taskId, companyId]
    );

    for (let index = 0; index < 6; index += 1) {
      await testDb.query(
        `INSERT INTO heartbeats (id, agent_id, task_id, status, details)
         VALUES ($1, $2, $3, 'error', '{}')`,
        [
          `00000000-0000-0000-0000-0000000004${String(index + 1).padStart(2, '0')}`,
          agentId,
          taskId,
        ]
      );
    }

    await expect(checkSafety(agentId, taskId)).resolves.toEqual({
      ok: false,
      reason: 'Too many consecutive errors',
    });
  });

  it('pauses the agent and sends both configured notifications', async () => {
    const agentId = '00000000-0000-0000-0000-000000000402';
    const queryMock = vi.fn(async (text: string, params?: any[]) => {
      if (text.includes("UPDATE agents SET status = 'paused'")) {
        expect(params).toEqual([JSON.stringify({ pause_reason: 'Message flood detected' }), agentId]);
        return { rows: [], rowCount: 1 };
      }

      if (text.includes('SELECT a.name as agent_name')) {
        expect(params).toEqual([agentId]);
        return {
          rows: [
            {
              agent_name: 'Ada',
              company_id: 'company-1',
              company_name: 'QA Test Corp',
              slack_webhook_url: 'https://hooks.slack.test/services/abc',
              discord_webhook_url: 'https://discord.test/api/webhooks/xyz',
            },
          ],
          rowCount: 1,
        };
      }

      if (text.includes("INSERT INTO audit_log") && text.includes("'agent.auto_paused'")) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected query in autoPauseAgent test: ${text}`);
    });

    deliverOutgoingWebhooksMock.mockResolvedValue([
      { target: 'slack', status: 'success', error: null },
      { target: 'discord', status: 'success', error: null },
    ]);
    dbState.impl = {
      query: queryMock,
    };

    await autoPauseAgent(agentId, 'Message flood detected');
    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      { agentId, reason: 'Message flood detected' },
      'Auto-pausing agent due to safety violation'
    );
    expect(deliverOutgoingWebhooksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-1',
        agentId,
        event: 'agent.auto_paused',
        slackWebhookUrl: 'https://hooks.slack.test/services/abc',
        discordWebhookUrl: 'https://discord.test/api/webhooks/xyz',
      })
    );
  });
});
