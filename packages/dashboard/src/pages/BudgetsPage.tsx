import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, WalletCards } from 'lucide-react';
import { useApi, useWebSocket } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';

type BudgetAgent = {
  id: string;
  name: string;
  role: string;
  title?: string | null;
  runtime: string;
  status: string;
  configured_limit_usd: number;
  limit_usd: number;
  spent_usd: number;
  remaining_usd: number;
  utilization_pct: number | null;
  last_7d_spend_usd: number;
  forecast: {
    avg_daily_spend_usd: number;
    days_in_month: number;
    current_day: number;
    remaining_days: number;
    projected_month_spend_usd: number;
    projected_over_limit_usd: number | null;
  };
};

type DailySpendPoint = {
  day: string;
  total_usd: number;
};

type BudgetSummary = {
  balance_usd: number;
  totals: {
    limit_usd: number;
    spent_usd: number;
    remaining_usd: number;
    utilization_pct: number | null;
    forecast: {
      avg_daily_spend_usd: number;
      days_in_month: number;
      current_day: number;
      remaining_days: number;
      projected_month_spend_usd: number;
      projected_over_limit_usd: number | null;
    };
  };
  daily_spend: DailySpendPoint[];
  agents: BudgetAgent[];
};

const emptySummary: BudgetSummary = {
  balance_usd: 0,
  totals: {
    limit_usd: 0,
    spent_usd: 0,
    remaining_usd: 0,
    utilization_pct: null,
    forecast: {
      avg_daily_spend_usd: 0,
      days_in_month: 0,
      current_day: 0,
      remaining_days: 0,
      projected_month_spend_usd: 0,
      projected_over_limit_usd: null,
    },
  },
  daily_spend: [],
  agents: [],
};

type BudgetToast = {
  id: string;
  tone: 'warning' | 'critical';
  message: string;
};

export default function BudgetsPage() {
  const { request, loading, error } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [summary, setSummary] = useState<BudgetSummary>(emptySummary);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const [budgetToasts, setBudgetToasts] = useState<BudgetToast[]>([]);
  const lastEvent = useWebSocket(selectedCompanyId ?? undefined) as {
    event: string;
    data?: {
      daily_cost_usd?: number;
      delta_cost_usd?: number;
      message?: string;
      tone?: 'warning' | 'critical';
      agentName?: string;
      agent_name?: string;
      threshold_pct?: number;
    };
    timestamp: string;
  } | null;

  useEffect(() => {
    const fetchSummary = async () => {
      if (!selectedCompanyId) {
        setSummary(emptySummary);
        return;
      }

      const data = await request(
        `/companies/${selectedCompanyId}/budgets-summary`,
        undefined,
        {
          suppressError: true,
          trackTrace: false,
        }
      );
      setSummary(data);
    };

    void fetchSummary();
  }, [request, selectedCompanyId]);

  useEffect(() => {
    if (!lastEvent || !selectedCompanyId) {
      return;
    }

    if (lastEvent.event === 'cost.updated') {
      if (
        typeof lastEvent.data?.delta_cost_usd === 'number' &&
        typeof lastEvent.data?.daily_cost_usd === 'number'
      ) {
        setLiveMessage(
          `Live update: +$${lastEvent.data.delta_cost_usd.toFixed(4)} heartbeat, $${lastEvent.data.daily_cost_usd.toFixed(4)} today.`
        );
      }

      void request(
        `/companies/${selectedCompanyId}/budgets-summary`,
        undefined,
        {
          suppressError: true,
          trackTrace: false,
        }
      ).then((data) => setSummary(data as BudgetSummary));
    }

    if (lastEvent.event === 'budget.threshold') {
      const tone: BudgetToast['tone'] =
        lastEvent.data?.tone === 'critical' ? 'critical' : 'warning';
      setBudgetToasts((current) =>
        [
          {
            id: `${lastEvent.timestamp}-${lastEvent.data?.threshold_pct ?? 80}`,
            tone,
            message:
              lastEvent.data?.message ??
              `${lastEvent.data?.agent_name ?? lastEvent.data?.agentName ?? 'Agent'} crossed a budget threshold.`,
          },
          ...current,
        ].slice(0, 3)
      );
      void request(
        `/companies/${selectedCompanyId}/budgets-summary`,
        undefined,
        {
          suppressError: true,
          trackTrace: false,
        }
      ).then((data) => setSummary(data as BudgetSummary));
    }
  }, [lastEvent, request, selectedCompanyId]);

  useEffect(() => {
    if (!liveMessage) {
      return;
    }

    const timeout = window.setTimeout(() => setLiveMessage(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [liveMessage]);

  useEffect(() => {
    if (budgetToasts.length === 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setBudgetToasts((current) => current.slice(0, -1));
    }, 5000);

    return () => window.clearTimeout(timeout);
  }, [budgetToasts]);

  if (!selectedCompany) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
        Choose a company to review budgets.
      </div>
    );
  }

  const maxDailySpend = Math.max(
    ...summary.daily_spend.map((point) => point.total_usd),
    0
  );

  return (
    <div className="space-y-6">
      {budgetToasts.length > 0 && (
        <div className="fixed right-4 top-4 z-40 space-y-3">
          {budgetToasts.map((toast) => (
            <div
              key={toast.id}
              className={`w-[320px] rounded-2xl border px-4 py-3 shadow-lg ${
                toast.tone === 'critical'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              <div className="text-sm font-semibold">Budget alert</div>
              <div className="mt-1 text-sm">{toast.message}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Budgets</h2>
          <p className="text-sm text-muted-foreground">
            Current month spend and runway for {selectedCompany.name}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm text-muted-foreground">
          <WalletCards className="h-4 w-4 text-emerald-600" />
          Available credits:{' '}
          <span className="font-semibold text-foreground">
            ${summary.balance_usd.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Live Budget Mode
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            This page auto-refreshes on heartbeat cost events and budget
            threshold alerts.
          </div>
          {liveMessage && (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {liveMessage}
            </div>
          )}
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Company Budget Gauge
          </div>
          <div className="mt-2 flex items-end justify-between gap-4">
            <div className="text-4xl font-semibold tracking-tight">
              {summary.totals.utilization_pct === null
                ? 'No cap'
                : `${summary.totals.utilization_pct.toFixed(0)}%`}
            </div>
            <div className="text-right text-sm text-muted-foreground">
              <div>${summary.totals.spent_usd.toFixed(2)} spent</div>
              <div>${summary.totals.limit_usd.toFixed(2)} limit</div>
            </div>
          </div>
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-muted/30">
            <div
              className={`h-full rounded-full transition-all ${
                summary.totals.utilization_pct !== null &&
                summary.totals.utilization_pct >= 95
                  ? 'bg-red-500'
                  : summary.totals.utilization_pct !== null &&
                      summary.totals.utilization_pct >= 80
                    ? 'bg-amber-400'
                    : 'bg-emerald-500'
              }`}
              style={{
                width: `${summary.totals.utilization_pct === null ? 0 : Math.max(Math.min(summary.totals.utilization_pct, 100), 4)}%`,
              }}
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>Warning at 80%, critical at 95%</span>
            <span>${summary.totals.remaining_usd.toFixed(2)} remaining</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Allocated This Month"
          value={`$${summary.totals.limit_usd.toFixed(2)}`}
          helper="Configured budget across active agents"
        />
        <SummaryCard
          title="Spent So Far"
          value={`$${summary.totals.spent_usd.toFixed(2)}`}
          helper="Usage recorded in current monthly budget rows"
        />
        <SummaryCard
          title="Remaining"
          value={`$${summary.totals.remaining_usd.toFixed(2)}`}
          helper="Budget still available before caps are hit"
        />
        <SummaryCard
          title="Usage Ratio"
          value={
            summary.totals.utilization_pct === null
              ? 'No cap'
              : `${summary.totals.utilization_pct.toFixed(0)}%`
          }
          helper="Share of allocated budget already consumed"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-3">
            <h3 className="text-lg font-semibold">End-of-Month Forecast</h3>
            <p className="text-sm text-muted-foreground">
              Projection based on the average daily spend from the last 7 days.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <ForecastMetric
              label="Projected Month Spend"
              value={`$${summary.totals.forecast.projected_month_spend_usd.toFixed(2)}`}
              helper={`${summary.totals.forecast.remaining_days} days remaining`}
            />
            <ForecastMetric
              label="7-Day Daily Average"
              value={`$${summary.totals.forecast.avg_daily_spend_usd.toFixed(2)}`}
              helper="Average company spend per day"
            />
            <ForecastMetric
              label="Projected Overrun"
              value={
                summary.totals.forecast.projected_over_limit_usd === null
                  ? 'No cap'
                  : `$${summary.totals.forecast.projected_over_limit_usd.toFixed(2)}`
              }
              helper={
                summary.totals.forecast.projected_over_limit_usd &&
                summary.totals.forecast.projected_over_limit_usd > 0
                  ? 'Current pace would exceed the configured monthly cap'
                  : 'Current pace stays within the configured budget'
              }
            />
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Forecast Notes</h3>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            <p>
              Forecast uses the last 7 calendar days, including zero-spend days,
              to avoid overreacting to one expensive heartbeat.
            </p>
            <p>
              Projection assumes current month-to-date spend stays booked and
              only the remaining days are extrapolated.
            </p>
            <p>
              Treat this as an early warning system, not a billing guarantee.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1.7fr]">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Daily Spend</h3>
              <p className="text-sm text-muted-foreground">
                Last 7 days of audit-tracked usage
              </p>
            </div>
            {loading && (
              <span className="text-xs text-muted-foreground">
                Refreshing...
              </span>
            )}
          </div>

          <div className="flex h-52 items-end gap-3 rounded-2xl bg-muted/20 p-4">
            {summary.daily_spend.map((point) => {
              const height =
                maxDailySpend > 0
                  ? Math.max((point.total_usd / maxDailySpend) * 100, 8)
                  : 8;
              const label = new Date(point.day).toLocaleDateString(undefined, {
                weekday: 'short',
              });

              return (
                <div
                  key={point.day}
                  className="flex flex-1 flex-col items-center gap-3"
                >
                  <div className="text-[11px] font-medium text-muted-foreground">
                    ${point.total_usd.toFixed(2)}
                  </div>
                  <div className="flex h-32 w-full items-end rounded-full bg-background px-1 py-1">
                    <div
                      className="w-full rounded-full bg-gradient-to-t from-sky-600 via-cyan-500 to-emerald-400 transition-all"
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {label}
                  </div>
                </div>
              );
            })}

            {summary.daily_spend.length === 0 && (
              <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                No recent spend data yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-4">
            <h3 className="text-lg font-semibold">Agent Budget Health</h3>
            <p className="text-sm text-muted-foreground">
              Sorted by pressure, so the riskiest budgets float to the top.
            </p>
          </div>

          <div className="space-y-4">
            {summary.agents.map((agent) => (
              <div
                key={agent.id}
                className="rounded-2xl border bg-muted/20 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/agents/${agent.id}`}
                        className="font-semibold text-foreground transition-colors hover:text-primary"
                      >
                        {agent.name}
                      </Link>
                      <span className="rounded-full bg-background px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {agent.runtime}
                      </span>
                      <span className="rounded-full bg-background px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {agent.status}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {agent.title || agent.role}
                    </div>
                  </div>

                  <Link
                    to={`/agents/${agent.id}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80"
                  >
                    Details
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      ${agent.spent_usd.toFixed(2)} spent of $
                      {agent.limit_usd.toFixed(2)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-medium uppercase tracking-wide ${
                        agent.utilization_pct !== null &&
                        agent.utilization_pct >= 95
                          ? 'bg-red-100 text-red-700'
                          : agent.utilization_pct !== null &&
                              agent.utilization_pct >= 80
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {agent.utilization_pct === null
                        ? 'No limit'
                        : `${agent.utilization_pct.toFixed(0)}% used`}
                    </span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-background">
                    <div
                      className={`h-full rounded-full transition-all ${
                        agent.utilization_pct !== null &&
                        agent.utilization_pct >= 95
                          ? 'bg-red-500'
                          : agent.utilization_pct !== null &&
                              agent.utilization_pct >= 80
                            ? 'bg-amber-400'
                            : 'bg-emerald-500'
                      }`}
                      style={{
                        width: `${agent.utilization_pct === null ? 0 : Math.max(Math.min(agent.utilization_pct, 100), 4)}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Remaining: ${agent.remaining_usd.toFixed(2)}</span>
                    <span>
                      Configured cap: ${agent.configured_limit_usd.toFixed(2)}
                    </span>
                  </div>
                  <div className="rounded-xl bg-background px-3 py-2 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        7-day avg: $
                        {agent.forecast.avg_daily_spend_usd.toFixed(2)}/day
                      </span>
                      <span>
                        Projected month: $
                        {agent.forecast.projected_month_spend_usd.toFixed(2)}
                      </span>
                    </div>
                    <div className="mt-1">
                      {agent.forecast.projected_over_limit_usd === null
                        ? 'No monthly cap configured for forecast comparison.'
                        : agent.forecast.projected_over_limit_usd > 0
                          ? `Projected over limit by $${agent.forecast.projected_over_limit_usd.toFixed(2)} if current pace holds.`
                          : 'Current pace remains within the configured monthly cap.'}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {summary.agents.length === 0 && !loading && (
              <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                No active agents with budgets yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  helper,
}: {
  title: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{helper}</div>
    </div>
  );
}

function ForecastMetric({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border bg-muted/20 p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{helper}</div>
    </div>
  );
}
