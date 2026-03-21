import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));
const canUseToolMock = vi.hoisted(() => vi.fn());
const executeToolMock = vi.hoisted(() => vi.fn());
const evaluatePolicyMock = vi.hoisted(() => vi.fn());
const createApprovalRequestMock = vi.hoisted(() => vi.fn());
const evaluateCriticalToolConsensusMock = vi.hoisted(() => vi.fn());
const broadcastCompanyEventMock = vi.hoisted(() => vi.fn());
const broadcastCollaborationSignalMock = vi.hoisted(() => vi.fn());
const findDelegateAgentMock = vi.hoisted(() => vi.fn());
const enqueueCompanyWakeupMock = vi.hoisted(() => vi.fn());
const storeMemoryMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
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

vi.mock('../src/governance/multiModelConsensus.js', () => ({
  evaluateCriticalToolConsensus: evaluateCriticalToolConsensusMock,
}));

vi.mock('../src/realtime/eventBus.js', () => ({
  broadcastCompanyEvent: broadcastCompanyEventMock,
}));

vi.mock('../src/services/collaboration.js', () => ({
  broadcastCollaborationSignal: broadcastCollaborationSignalMock,
  findDelegateAgent: findDelegateAgentMock,
}));

vi.mock('../src/orchestrator/schedulerQueue.js', () => ({
  enqueueCompanyWakeup: enqueueCompanyWakeupMock,
}));

vi.mock('../src/orchestrator/memory.js', () => ({
  storeMemory: storeMemoryMock,
}));

import { handleHeartbeatAction } from '../src/orchestrator/heartbeatActions.js';

describe('heartbeatActions', () => {
  const task = {
    id: 'task-1',
    company_id: 'company-1',
    assigned_to: 'agent-1',
    title: 'Execute refund',
    description: 'Issue the approved refund.',
  };

  beforeEach(() => {
    dbMock.query.mockReset();
    canUseToolMock.mockReset();
    executeToolMock.mockReset();
    evaluatePolicyMock.mockReset();
    createApprovalRequestMock.mockReset();
    evaluateCriticalToolConsensusMock.mockReset();
    broadcastCompanyEventMock.mockReset();
    broadcastCollaborationSignalMock.mockReset();
    findDelegateAgentMock.mockReset();
    enqueueCompanyWakeupMock.mockReset();
    storeMemoryMock.mockReset();
  });

  it('executes the tool when consensus reaches 2 of 3 approvals', async () => {
    evaluatePolicyMock
      .mockResolvedValueOnce({ allowed: true, requires_approval: false })
      .mockResolvedValueOnce({ allowed: true, requires_approval: false });
    canUseToolMock.mockResolvedValue(true);
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-1',
            name: 'payments.execute',
            description: 'Execute a payout',
            type: 'http',
            config: { governance: { critical: true } },
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    evaluateCriticalToolConsensusMock.mockResolvedValue({
      required: true,
      accepted: true,
      approvals: 2,
      minimumApprovals: 2,
      totalVotes: 3,
      decisionType: 'payment_execution',
      source: 'tool_config',
      fallbackToApproval: true,
      reason: 'Consensus approved by 2/3 runtimes.',
      votes: [],
    });
    executeToolMock.mockResolvedValue({ ok: true });

    await handleHeartbeatAction('agent-1', task, {
      type: 'use_tool',
      tool_name: 'payments.execute',
      params: { amount: 10 },
    });

    expect(evaluateCriticalToolConsensusMock).toHaveBeenCalledWith({
      companyId: 'company-1',
      task: {
        id: 'task-1',
        title: 'Execute refund',
        description: 'Issue the approved refund.',
      },
      tool: expect.objectContaining({
        name: 'payments.execute',
      }),
      params: { amount: 10 },
    });
    expect(executeToolMock).toHaveBeenCalledWith(
      'agent-1',
      'task-1',
      'payments.execute',
      { amount: 10 }
    );
    expect(createApprovalRequestMock).not.toHaveBeenCalled();
  });

  it('blocks the task and creates an approval when consensus rejects execution', async () => {
    evaluatePolicyMock
      .mockResolvedValueOnce({ allowed: true, requires_approval: false })
      .mockResolvedValueOnce({ allowed: true, requires_approval: false });
    canUseToolMock.mockResolvedValue(true);
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'tool-1',
            name: 'payments.execute',
            description: 'Execute a payout',
            type: 'http',
            config: { governance: { critical: true } },
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    evaluateCriticalToolConsensusMock.mockResolvedValue({
      required: true,
      accepted: false,
      approvals: 1,
      minimumApprovals: 2,
      totalVotes: 3,
      decisionType: 'payment_execution',
      source: 'tool_config',
      fallbackToApproval: true,
      reason: 'Consensus rejected with 1/3 approvals.',
      votes: [],
    });

    await handleHeartbeatAction('agent-1', task, {
      type: 'use_tool',
      tool_name: 'payments.execute',
      params: { amount: 10 },
    });

    expect(createApprovalRequestMock).toHaveBeenCalledWith(
      'company-1',
      'task-1',
      'agent-1',
      'Consensus rejected with 1/3 approvals.',
      expect.objectContaining({
        action: 'use_tool',
        tool_name: 'payments.execute',
        consensus: expect.objectContaining({
          accepted: false,
          approvals: 1,
        }),
      }),
      undefined
    );
    expect(broadcastCollaborationSignalMock).toHaveBeenCalledWith(
      'company-1',
      'task-1',
      'status_update',
      expect.objectContaining({
        status: 'blocked',
      })
    );
    expect(broadcastCompanyEventMock).toHaveBeenCalledWith(
      'company-1',
      'task.updated',
      expect.objectContaining({
        task_id: 'task-1',
        status: 'blocked',
      }),
      'worker'
    );
    expect(executeToolMock).not.toHaveBeenCalled();
  });

  it('requests approval immediately when approval_required targets the tool', async () => {
    evaluatePolicyMock.mockResolvedValueOnce({
      allowed: false,
      requires_approval: true,
      reason: 'Policy: Payment review',
      policy_id: 'policy-1',
    });

    await handleHeartbeatAction('agent-1', task, {
      type: 'use_tool',
      tool_name: 'payments.execute',
      params: { amount: 10 },
    });

    expect(createApprovalRequestMock).toHaveBeenCalledWith(
      'company-1',
      'task-1',
      'agent-1',
      'Policy: Payment review',
      {
        action: 'use_tool',
        tool_name: 'payments.execute',
        params: { amount: 10 },
      },
      'policy-1'
    );
    expect(evaluateCriticalToolConsensusMock).not.toHaveBeenCalled();
    expect(executeToolMock).not.toHaveBeenCalled();
  });

  it('completes a task, broadcasts status, and stores memory', async () => {
    dbMock.query.mockResolvedValue({ rows: [] });

    await handleHeartbeatAction('agent-1', task, {
      type: 'complete_task',
      result: 'Refund completed successfully.',
    });

    expect(dbMock.query).toHaveBeenCalledWith(
      "UPDATE tasks SET status = 'done', result = $1, completed_at = now() WHERE id = $2",
      ['Refund completed successfully.', 'task-1']
    );
    expect(broadcastCollaborationSignalMock).toHaveBeenCalledWith(
      'company-1',
      'task-1',
      'status_update',
      {
        agent_id: 'agent-1',
        status: 'done',
      }
    );
    expect(broadcastCompanyEventMock).toHaveBeenCalledWith(
      'company-1',
      'task.updated',
      {
        company_id: 'company-1',
        task_id: 'task-1',
        status: 'done',
        assigned_to: 'agent-1',
        result: 'Refund completed successfully.',
        source: 'heartbeat_complete',
      },
      'worker'
    );
    expect(storeMemoryMock).toHaveBeenCalledWith(
      'company-1',
      'agent-1',
      'task-1',
      'Task: Execute refund\nResult: Refund completed successfully.',
      {
        task_title: 'Execute refund',
        source: 'complete_task',
      }
    );
  });

  it('delegates work to a matching agent and creates a handoff message', async () => {
    evaluatePolicyMock.mockResolvedValueOnce({
      allowed: true,
      requires_approval: false,
    });
    findDelegateAgentMock.mockResolvedValue({
      id: 'agent-2',
      name: 'Ben',
    });
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'task-2', assigned_to: 'agent-2' }],
      })
      .mockResolvedValue({ rows: [] });

    await handleHeartbeatAction('agent-1', task, {
      type: 'delegate',
      to_role: 'finance_specialist',
      name: 'Verify refund settlement',
      description: 'Confirm the payment settled before notifying finance.',
    });

    expect(findDelegateAgentMock).toHaveBeenCalledWith(
      'company-1',
      'finance_specialist',
      'agent-1'
    );
    expect(enqueueCompanyWakeupMock).toHaveBeenCalledWith(
      'company-1',
      'delegated_task_created',
      {
        taskId: 'task-2',
        agentId: 'agent-2',
      }
    );
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tasks'),
      [
        'company-1',
        'task-1',
        'Delegated: Verify refund settlement',
        'Confirm the payment settled before notifying finance.',
        'agent-2',
        'assigned',
        JSON.stringify({
          delegated_by_agent_id: 'agent-1',
          delegated_to_role: 'finance_specialist',
        }),
      ]
    );
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, $2, $3, $4, $5, 'delegation', $6)"),
      [
        'company-1',
        'task-1',
        'agent-1',
        'agent-2',
        'Delegated "Verify refund settlement" to Ben.',
        JSON.stringify({
          child_task_id: 'task-2',
          delegated_to_role: 'finance_specialist',
          delegated_to_agent_id: 'agent-2',
        }),
      ]
    );
    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, $2, $3, $4, $5, 'message', $6)"),
      [
        'company-1',
        'task-2',
        'agent-1',
        'agent-2',
        'Confirm the payment settled before notifying finance.',
        JSON.stringify({
          source: 'auto_delegation_handoff',
          parent_task_id: 'task-1',
          parent_task_title: 'Execute refund',
        }),
      ]
    );
    expect(broadcastCollaborationSignalMock).toHaveBeenCalledWith(
      'company-1',
      'task-1',
      'delegation',
      {
        agent_id: 'agent-1',
        delegated_task_id: 'task-2',
        delegated_to_agent_id: 'agent-2',
        delegated_to_role: 'finance_specialist',
      }
    );
  });

  it('blocks delegation and creates an approval when the delegation policy requires it', async () => {
    evaluatePolicyMock.mockResolvedValueOnce({
      allowed: false,
      requires_approval: true,
      reason: 'Delegation limit reached',
      policy_id: 'policy-delegate',
    });
    dbMock.query
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({ rows: [] });

    await handleHeartbeatAction('agent-1', task, {
      type: 'delegate',
      to_role: 'finance_specialist',
      name: 'Verify refund settlement',
      description: 'Confirm the payment settled before notifying finance.',
    });

    expect(createApprovalRequestMock).toHaveBeenCalledWith(
      'company-1',
      'task-1',
      'agent-1',
      'Delegation limit reached',
      {
        type: 'delegate',
        to_role: 'finance_specialist',
        name: 'Verify refund settlement',
        description: 'Confirm the payment settled before notifying finance.',
      },
      'policy-delegate'
    );
    expect(dbMock.query).toHaveBeenCalledWith(
      "UPDATE tasks SET status = 'blocked' WHERE id = $1",
      ['task-1']
    );
    expect(findDelegateAgentMock).not.toHaveBeenCalled();
    expect(enqueueCompanyWakeupMock).not.toHaveBeenCalled();
  });

  it('blocks the task when an agent explicitly requests approval', async () => {
    dbMock.query.mockResolvedValue({ rows: [] });

    await handleHeartbeatAction('agent-1', task, {
      type: 'request_approval',
      reason: 'Manual approval required for the refund.',
      payload: {
        amount: 125,
        currency: 'USD',
      },
    });

    expect(createApprovalRequestMock).toHaveBeenCalledWith(
      'company-1',
      'task-1',
      'agent-1',
      'Manual approval required for the refund.',
      {
        amount: 125,
        currency: 'USD',
      },
      undefined
    );
    expect(dbMock.query).toHaveBeenCalledWith(
      "UPDATE tasks SET status = 'blocked', locked_by = NULL, locked_at = NULL WHERE id = $1",
      ['task-1']
    );
    expect(broadcastCollaborationSignalMock).toHaveBeenCalledWith(
      'company-1',
      'task-1',
      'status_update',
      {
        agent_id: 'agent-1',
        status: 'blocked',
      }
    );
    expect(broadcastCompanyEventMock).toHaveBeenCalledWith(
      'company-1',
      'task.updated',
      {
        company_id: 'company-1',
        task_id: 'task-1',
        status: 'blocked',
        assigned_to: 'agent-1',
        source: 'approval_requested',
      },
      'worker'
    );
  });

  it('posts a direct agent message and broadcasts the collaboration signal', async () => {
    dbMock.query.mockResolvedValue({ rows: [] });

    await handleHeartbeatAction('agent-1', task, {
      type: 'message',
      to_agent_id: '33333333-3333-4333-8333-333333333333',
      content: 'Please confirm the refund ledger entry.',
    });

    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, $2, $3, $4, $5, 'message')"),
      [
        'company-1',
        'task-1',
        'agent-1',
        '33333333-3333-4333-8333-333333333333',
        'Please confirm the refund ledger entry.',
      ]
    );
    expect(broadcastCollaborationSignalMock).toHaveBeenCalledWith(
      'company-1',
      'task-1',
      'message',
      {
        agent_id: 'agent-1',
        to_agent_id: '33333333-3333-4333-8333-333333333333',
      }
    );
  });

  it('records a continue thought as a status update', async () => {
    dbMock.query.mockResolvedValue({ rows: [] });

    await handleHeartbeatAction('agent-1', task, {
      type: 'continue',
      thought: 'Waiting for finance confirmation before closing the loop.',
    });

    expect(dbMock.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, $2, $3, $4, 'status_update')"),
      [
        'company-1',
        'task-1',
        'agent-1',
        'Waiting for finance confirmation before closing the loop.',
      ]
    );
    expect(broadcastCollaborationSignalMock).toHaveBeenCalledWith(
      'company-1',
      'task-1',
      'status_update',
      {
        agent_id: 'agent-1',
      }
    );
  });
});
