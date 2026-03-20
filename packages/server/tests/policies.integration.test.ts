import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

import {
  evaluatePolicy,
  invalidatePolicyCache,
} from '../src/governance/policies.js';

describe('evaluatePolicy integration flows', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    invalidatePolicyCache();
  });

  it('blocks heartbeats when rate_limit threshold is reached', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'policy-rate',
            name: 'Hourly cap',
            rules: { max_per_hour: 3 },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ count: 3 }],
      });

    await expect(
      evaluatePolicy('company-1', 'rate_limit', { agentId: 'agent-1' })
    ).resolves.toEqual({
      allowed: false,
      requires_approval: false,
      reason: 'Agent rate limit exceeded',
    });

    expect(dbMock.query).toHaveBeenCalledTimes(2);
  });

  it('blocks a tool when tool_restriction lists it as forbidden', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'policy-tool',
          name: 'No bash',
          rules: { blocked_tools: ['bash.exec', 'crm.write'] },
        },
      ],
    });

    await expect(
      evaluatePolicy('company-1', 'tool_restriction', {
        tool_name: 'bash.exec',
      })
    ).resolves.toEqual({
      allowed: false,
      requires_approval: false,
      reason: 'Tool blocked by policy: bash.exec',
    });
  });

  it('falls through when no matching rule is triggered', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'policy-approval',
          name: 'Review destructive actions',
          rules: { actions: ['delete'] },
        },
      ],
    });

    await expect(
      evaluatePolicy('company-1', 'approval_required', { action: 'create' })
    ).resolves.toEqual({
      allowed: true,
      requires_approval: false,
    });
  });

  it('reuses cached policies for repeated evaluations of the same company and type', async () => {
    dbMock.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'policy-tool',
          name: 'No bash',
          rules: { blocked_tools: ['bash.exec'] },
        },
      ],
    });

    await evaluatePolicy('company-1', 'tool_restriction', {
      tool_name: 'bash.exec',
    });
    await evaluatePolicy('company-1', 'tool_restriction', {
      tool_name: 'bash.exec',
    });

    expect(dbMock.query).toHaveBeenCalledTimes(1);
  });

  it('invalidates cached policies for a company after writes', async () => {
    dbMock.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'policy-tool',
            name: 'No bash',
            rules: { blocked_tools: ['bash.exec'] },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'policy-tool-2',
            name: 'No crm',
            rules: { blocked_tools: ['crm.write'] },
          },
        ],
      });

    await evaluatePolicy('company-1', 'tool_restriction', {
      tool_name: 'bash.exec',
    });

    invalidatePolicyCache('company-1');

    await expect(
      evaluatePolicy('company-1', 'tool_restriction', {
        tool_name: 'crm.write',
      })
    ).resolves.toEqual({
      allowed: false,
      requires_approval: false,
      reason: 'Tool blocked by policy: crm.write',
    });

    expect(dbMock.query).toHaveBeenCalledTimes(2);
  });
});
