import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));
const getDirectRuntimeMock = vi.hoisted(() => vi.fn());
const getAvailableRuntimeNamesMock = vi.hoisted(() => vi.fn());

vi.mock('../src/db/client.js', () => ({
  db: dbMock,
}));

vi.mock('../src/runtime/registry.js', () => ({
  runtimeRegistry: {
    getDirectRuntime: getDirectRuntimeMock,
    getAvailableRuntimeNames: getAvailableRuntimeNamesMock,
  },
}));

import {
  evaluateCriticalToolConsensus,
  requiresCriticalConsensus,
} from '../src/governance/multiModelConsensus.js';

describe('multi-model consensus', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    getDirectRuntimeMock.mockReset();
    getAvailableRuntimeNamesMock.mockReset();
  });

  it('accepts a critical tool when at least 2 of 3 runtimes approve execution', async () => {
    dbMock.query.mockResolvedValue({
      rows: [
        {
          name: 'QA Test Corp',
          mission: 'Ship reliable software',
          config: {
            llm_primary_runtime: 'gemini',
            llm_fallback_order: ['gemini', 'claude', 'openai'],
          },
        },
      ],
    });
    getAvailableRuntimeNamesMock.mockReturnValue([
      'gemini',
      'claude',
      'openai',
    ]);
    getDirectRuntimeMock.mockImplementation((runtime: string) => ({
      execute: vi.fn().mockResolvedValue({
        thought: JSON.stringify({
          approve: runtime !== 'openai',
          confidence: runtime === 'gemini' ? 'high' : 'medium',
          rationale: `${runtime} vote`,
          risk_flags: runtime === 'openai' ? ['missing_context'] : [],
        }),
        actions: [
          {
            type: 'continue',
            thought: JSON.stringify({
              approve: runtime !== 'openai',
              confidence: runtime === 'gemini' ? 'high' : 'medium',
              rationale: `${runtime} vote`,
              risk_flags: runtime === 'openai' ? ['missing_context'] : [],
            }),
          },
        ],
      }),
    }));

    const result = await evaluateCriticalToolConsensus({
      companyId: 'company-1',
      task: {
        id: 'task-1',
        title: 'Issue payout',
        description: 'Execute the payout after validation.',
      },
      tool: {
        id: 'tool-1',
        name: 'payments.execute',
        description: 'Execute a customer payout',
        type: 'http',
        config: {
          governance: {
            critical: true,
            consensus: {
              enabled: true,
              voter_runtimes: ['gemini', 'claude', 'openai'],
            },
          },
        },
      },
      params: {
        amount: 249.99,
        currency: 'USD',
      },
    });

    expect(result).toMatchObject({
      required: true,
      accepted: true,
      approvals: 2,
      minimumApprovals: 2,
      totalVotes: 3,
      decisionType: 'critical_tool_execution',
      source: 'tool_config',
    });
    expect(result.votes).toHaveLength(3);
    expect(getDirectRuntimeMock).toHaveBeenCalledTimes(3);
  });

  it('fails closed when fewer than 3 distinct runtimes are available', async () => {
    dbMock.query.mockResolvedValue({
      rows: [
        {
          name: 'QA Test Corp',
          mission: 'Ship reliable software',
          config: {
            llm_primary_runtime: 'gemini',
            llm_fallback_order: ['gemini', 'openai'],
          },
        },
      ],
    });
    getAvailableRuntimeNamesMock.mockReturnValue(['gemini', 'openai']);

    const result = await evaluateCriticalToolConsensus({
      companyId: 'company-1',
      task: {
        id: 'task-1',
        title: 'Issue payout',
      },
      tool: {
        name: 'payments.execute',
        description: 'Execute a customer payout',
        type: 'http',
        config: {
          governance: {
            critical: true,
          },
        },
      },
      params: {},
    });

    expect(result).toEqual({
      required: true,
      accepted: false,
      approvals: 0,
      minimumApprovals: 2,
      totalVotes: 2,
      decisionType: 'critical_tool_execution',
      source: 'tool_config',
      fallbackToApproval: true,
      reason:
        'Consensus requires 3 distinct runtimes, but only 2 are available.',
      votes: [],
    });
    expect(getDirectRuntimeMock).not.toHaveBeenCalled();
  });

  it('detects payment-like tools heuristically even without explicit config', () => {
    expect(
      requiresCriticalConsensus({
        name: 'stripe.transfer',
        description: 'Issue an external bank transfer',
        type: 'http',
        config: {
          url: 'https://api.stripe.com/v1/transfers',
        },
      })
    ).toMatchObject({
      required: true,
      source: 'heuristic',
      decisionType: 'payment_execution',
      minimumApprovals: 2,
      totalVoters: 3,
    });
  });
});
