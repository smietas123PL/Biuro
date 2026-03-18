import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

import { evaluatePolicy } from '../src/governance/policies.js';

describe('evaluatePolicy integration flows', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
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
      evaluatePolicy('company-1', 'tool_restriction', { tool_name: 'bash.exec' })
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
});
