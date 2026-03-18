import { describe, expect, it } from 'vitest';
import { attachBudgetForecasts, buildBudgetForecast, buildDailySpendSeries, summarizeAgentBudgets } from '../src/utils/budgets.js';

describe('buildDailySpendSeries', () => {
  it('fills missing days and preserves existing spend values', () => {
    const series = buildDailySpendSeries(
      [
        { day: '2026-03-12', total_usd: 3.5 },
        { day: '2026-03-16', total_usd: 1.25 },
        { day: '2026-03-18', total_usd: 4.75 },
      ],
      new Date('2026-03-18T10:00:00Z')
    );

    expect(series).toEqual([
      { day: '2026-03-12', total_usd: 3.5 },
      { day: '2026-03-13', total_usd: 0 },
      { day: '2026-03-14', total_usd: 0 },
      { day: '2026-03-15', total_usd: 0 },
      { day: '2026-03-16', total_usd: 1.25 },
      { day: '2026-03-17', total_usd: 0 },
      { day: '2026-03-18', total_usd: 4.75 },
    ]);
  });
});

describe('summarizeAgentBudgets', () => {
  it('computes remaining budget and totals for active agents', () => {
    const summary = summarizeAgentBudgets([
      {
        id: 'agent-1',
        name: 'Ada',
        role: 'cto',
        title: 'CTO',
        runtime: 'claude',
        status: 'working',
        configured_limit_usd: '50',
        limit_usd: '50',
        spent_usd: '12.5',
      },
      {
        id: 'agent-2',
        name: 'Max',
        role: 'ops',
        title: 'Ops Lead',
        runtime: 'openai',
        status: 'idle',
        configured_limit_usd: 20,
        limit_usd: 20,
        spent_usd: 5,
      },
    ]);

    expect(summary.agents[0]).toMatchObject({
      name: 'Ada',
      remaining_usd: 37.5,
      utilization_pct: 25,
    });

    expect(summary.agents[1]).toMatchObject({
      name: 'Max',
      remaining_usd: 15,
      utilization_pct: 25,
    });

    expect(summary.totals).toEqual({
      limit_usd: 70,
      spent_usd: 17.5,
      remaining_usd: 52.5,
      utilization_pct: 25,
    });
  });

  it('leaves utilization as null when no budget limit exists', () => {
    const summary = summarizeAgentBudgets([
      {
        id: 'agent-3',
        name: 'Nova',
        role: 'analyst',
        title: null,
        runtime: 'gemini',
        status: 'idle',
        configured_limit_usd: 0,
        limit_usd: 0,
        spent_usd: 0,
      },
    ]);

    expect(summary.agents[0]?.utilization_pct).toBeNull();
    expect(summary.totals.utilization_pct).toBeNull();
  });
});

describe('buildBudgetForecast', () => {
  it('projects month-end spend from the last 7 days average', () => {
    const forecast = buildBudgetForecast({
      totalSpentUsd: 42,
      last7dSpendUsd: 14,
      today: new Date('2026-03-18T10:00:00Z'),
    });

    expect(forecast).toEqual({
      avg_daily_spend_usd: 2,
      days_in_month: 31,
      current_day: 18,
      remaining_days: 13,
      projected_month_spend_usd: 68,
    });
  });
});

describe('attachBudgetForecasts', () => {
  it('merges agent-level 7 day spend into forecast data', () => {
    const agentsWithForecast = attachBudgetForecasts(
      [
        {
          id: 'agent-1',
          name: 'Ada',
          role: 'cto',
          title: 'CTO',
          runtime: 'claude',
          status: 'working',
          configured_limit_usd: 50,
          limit_usd: 50,
          spent_usd: 12.5,
          remaining_usd: 37.5,
          utilization_pct: 25,
        },
      ],
      [{ agent_id: 'agent-1', last_7d_spend_usd: 14 }],
      new Date('2026-03-18T10:00:00Z')
    );

    expect(agentsWithForecast[0]).toMatchObject({
      last_7d_spend_usd: 14,
      forecast: {
        avg_daily_spend_usd: 2,
        projected_month_spend_usd: 38.5,
        projected_over_limit_usd: 0,
      },
    });
  });
});
