export type DailySpendPoint = {
  day: string;
  total_usd: number;
};

export type RawBudgetAgentRow = {
  id: string;
  name: string;
  role: string;
  title?: string | null;
  runtime: string;
  status: string;
  configured_limit_usd: unknown;
  limit_usd: unknown;
  spent_usd: unknown;
};

export type RawAgentSpendRow = {
  agent_id: string;
  last_7d_spend_usd: unknown;
};

export function toFloat(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatLocalDay(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildDailySpendSeries(points: DailySpendPoint[], today = new Date()) {
  const normalizedToday = new Date(today);
  normalizedToday.setHours(0, 0, 0, 0);

  const pointsMap = new Map(points.map((point) => [point.day, toFloat(point.total_usd)]));

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(normalizedToday);
    date.setDate(normalizedToday.getDate() - (6 - index));
    const day = formatLocalDay(date);

    return {
      day,
      total_usd: pointsMap.get(day) ?? 0,
    };
  });
}

export function summarizeAgentBudgets(rows: RawBudgetAgentRow[]) {
  const agents = rows.map((row) => {
    const limitUsd = toFloat(row.limit_usd);
    const spentUsd = toFloat(row.spent_usd);
    const remainingUsd = Math.max(limitUsd - spentUsd, 0);
    const utilizationPct = limitUsd > 0 ? Math.min((spentUsd / limitUsd) * 100, 100) : null;

    return {
      id: row.id,
      name: row.name,
      role: row.role,
      title: row.title ?? null,
      runtime: row.runtime,
      status: row.status,
      configured_limit_usd: toFloat(row.configured_limit_usd),
      limit_usd: limitUsd,
      spent_usd: spentUsd,
      remaining_usd: remainingUsd,
      utilization_pct: utilizationPct,
    };
  });

  const totals = agents.reduce(
    (acc, agent) => {
      acc.limit_usd += agent.limit_usd;
      acc.spent_usd += agent.spent_usd;
      acc.remaining_usd += agent.remaining_usd;
      return acc;
    },
    { limit_usd: 0, spent_usd: 0, remaining_usd: 0 }
  );

  return {
    agents,
    totals: {
      ...totals,
      utilization_pct: totals.limit_usd > 0 ? Math.min((totals.spent_usd / totals.limit_usd) * 100, 100) : null,
    },
  };
}

export function buildBudgetForecast(params: {
  totalSpentUsd: number;
  last7dSpendUsd: number;
  today?: Date;
}) {
  const today = params.today ? new Date(params.today) : new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const currentDay = today.getDate();
  const remainingDays = Math.max(daysInMonth - currentDay, 0);
  const avgDailySpendUsd = toFloat(params.last7dSpendUsd) / 7;
  const projectedMonthSpendUsd = toFloat(params.totalSpentUsd) + (avgDailySpendUsd * remainingDays);

  return {
    avg_daily_spend_usd: avgDailySpendUsd,
    days_in_month: daysInMonth,
    current_day: currentDay,
    remaining_days: remainingDays,
    projected_month_spend_usd: projectedMonthSpendUsd,
  };
}

export function attachBudgetForecasts<
  T extends {
    id: string;
    spent_usd: number;
    limit_usd: number;
  }
>(agents: T[], spendRows: RawAgentSpendRow[], today?: Date) {
  const spendMap = new Map(
    spendRows.map((row) => [row.agent_id, toFloat(row.last_7d_spend_usd)])
  );

  return agents.map((agent) => {
    const last7dSpendUsd = spendMap.get(agent.id) ?? 0;
    const forecast = buildBudgetForecast({
      totalSpentUsd: agent.spent_usd,
      last7dSpendUsd,
      today,
    });

    return {
      ...agent,
      last_7d_spend_usd: last7dSpendUsd,
      forecast: {
        ...forecast,
        projected_over_limit_usd:
          agent.limit_usd > 0
            ? Math.max(forecast.projected_month_spend_usd - agent.limit_usd, 0)
            : null,
      },
    };
  });
}
