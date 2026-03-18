import { useEffect, useState } from 'react';
import { Activity, Clock3, ShieldAlert, Users } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';

type CompanyStats = {
  agent_count: number;
  active_agents: number;
  idle_agents: number;
  paused_agents: number;
  task_count: number;
  pending_tasks: number;
  completed_tasks: number;
  blocked_tasks: number;
  goal_count: number;
  pending_approvals: number;
  daily_cost_usd: number;
};

const emptyStats: CompanyStats = {
  agent_count: 0,
  active_agents: 0,
  idle_agents: 0,
  paused_agents: 0,
  task_count: 0,
  pending_tasks: 0,
  completed_tasks: 0,
  blocked_tasks: 0,
  goal_count: 0,
  pending_approvals: 0,
  daily_cost_usd: 0,
};

export default function DashboardPage() {
  const { request, loading, error } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [stats, setStats] = useState<CompanyStats>(emptyStats);

  useEffect(() => {
    const fetchStats = async () => {
      if (!selectedCompanyId) {
        setStats(emptyStats);
        return;
      }

      const data = await request(`/companies/${selectedCompanyId}/stats`);
      setStats(data);
    };

    void fetchStats();
  }, [request, selectedCompanyId]);

  if (!selectedCompany) {
    return <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">Choose a company to see live metrics.</div>;
  }

  const cards = [
    {
      title: 'Active Agents',
      value: stats.active_agents,
      detail: `${stats.agent_count} total, ${stats.idle_agents} idle`,
      icon: Users,
      tone: 'text-sky-700 bg-sky-50 border-sky-200',
    },
    {
      title: 'Pending Tasks',
      value: stats.pending_tasks,
      detail: `${stats.completed_tasks} completed, ${stats.blocked_tasks} blocked`,
      icon: Clock3,
      tone: 'text-amber-700 bg-amber-50 border-amber-200',
    },
    {
      title: 'Daily Cost',
      value: `$${stats.daily_cost_usd.toFixed(4)}`,
      detail: "Usage from today's audit log",
      icon: Activity,
      tone: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    },
    {
      title: 'Approvals Waiting',
      value: stats.pending_approvals,
      detail: `${stats.goal_count} goals tracked`,
      icon: ShieldAlert,
      tone: 'text-rose-700 bg-rose-50 border-rose-200',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Overview</h2>
        <p className="text-sm text-muted-foreground">
          Live operating snapshot for {selectedCompany.name}
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.title} className={`rounded-2xl border p-5 shadow-sm ${card.tone}`}>
            <div className="mb-6 flex items-center justify-between">
              <span className="text-sm font-medium">{card.title}</span>
              <card.icon className="h-5 w-5" />
            </div>
            <div className="text-3xl font-bold tracking-tight">{card.value}</div>
            <div className="mt-2 text-sm opacity-80">{card.detail}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Operations Snapshot</h3>
            {loading && <span className="text-xs text-muted-foreground">Refreshing...</span>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Metric label="All Tasks" value={stats.task_count} helper="Open and completed work combined" />
            <Metric label="Goals" value={stats.goal_count} helper="Strategic objectives in the system" />
            <Metric label="Paused Agents" value={stats.paused_agents} helper="Requires manual follow-up" />
            <Metric label="Completed Today" value={stats.completed_tasks} helper="Tasks marked done so far" />
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">What To Watch</h3>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            <Insight
              title="Task flow"
              body={stats.pending_tasks > 0 ? `${stats.pending_tasks} tasks are still in motion.` : 'Backlog is clear right now.'}
            />
            <Insight
              title="Agent utilization"
              body={stats.active_agents > 0 ? `${stats.active_agents} agents are currently working.` : 'No agents are actively processing work.'}
            />
            <Insight
              title="Governance"
              body={stats.pending_approvals > 0 ? `${stats.pending_approvals} approval requests need attention.` : 'No approval bottlenecks at the moment.'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, helper }: { label: string; value: number; helper: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{helper}</div>
    </div>
  );
}

function Insight({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-1">{body}</div>
    </div>
  );
}
