import { BrainCircuit, GraduationCap } from 'lucide-react';
import { Link } from 'react-router-dom';

export type MemoryInsightsSummary = {
  range_days: number;
  summary: {
    total_memories: number;
    recent_memories: number;
    agents_with_memories: number;
    tasks_with_memories: number;
    memory_reuse_searches: number;
  };
  recurring_topics: Array<{
    label: string;
    count: number;
  }>;
  top_agents: Array<{
    agent_id: string;
    agent_name: string;
    total_memories: number;
    latest_memory_at: string;
  }>;
  revisited_queries: Array<{
    query: string;
    total: number;
  }>;
  recent_lessons: Array<{
    id: string;
    content: string;
    created_at: string;
    agent_id: string;
    agent_name: string;
    task_id: string | null;
    task_title: string | null;
  }>;
};

interface MemoryInsightsProps {
  insights: MemoryInsightsSummary | null;
}

export function MemoryInsights({ insights }: MemoryInsightsProps) {
  if (!insights) return null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
                <BrainCircuit className="w-5 h-5 text-primary" />
                Memory Insights
            </h3>
            <p className="text-sm text-muted-foreground">
              What agents learned from history over the last{' '}
              {insights.range_days} days.
            </p>
          </div>
          <span className="rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
            {insights.summary.recent_memories} new lessons
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Total memory"
            value={insights.summary.total_memories}
            helper="All saved experiences across agents"
          />
          <Metric
            label="Agents learning"
            value={insights.summary.agents_with_memories}
            helper="Unique agents who stored memory recently"
          />
          <Metric
            label="Tasks covered"
            value={insights.summary.tasks_with_memories}
            helper="Distinct tasks represented in memory"
          />
          <Metric
            label="Reuse searches"
            value={insights.summary.memory_reuse_searches}
            helper="Times agents searched past memory"
          />
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <SummaryGroup
            title="Recurring lessons"
            empty="Recurring themes will appear after several similar memories are stored."
            items={insights.recurring_topics.map((item) => ({
              label: item.label,
              value: `${item.count}x`,
            }))}
          />
          <SummaryGroup
            title="Top learning agents"
            empty="No agents have stored memory in this window yet."
            items={insights.top_agents.map((item) => ({
              label: item.agent_name,
              value: `${item.total_memories} lessons`,
            }))}
          />
        </div>

        <div className="mt-5 rounded-xl border bg-muted/20 p-4">
          <div className="text-sm font-medium text-foreground">
            Most revisited questions
          </div>
          <div className="mt-3 space-y-2">
            {insights.revisited_queries.length > 0 ? (
              insights.revisited_queries.map((item) => (
                <div
                  key={`${item.query}-${item.total}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-background/60 px-3 py-2 text-sm"
                >
                  <span className="truncate text-muted-foreground">
                    {item.query}
                  </span>
                  <span className="font-medium text-foreground">
                    {item.total}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">
                Memory reuse patterns will show up here after agents start
                querying history.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-primary" />
            Recent Lessons
        </h3>
        <div className="mt-4 space-y-3">
          {insights.recent_lessons.map((item) => (
            <div key={item.id} className="rounded-xl border bg-muted/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-foreground">
                    {item.agent_name}
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {item.task_title || 'No linked task'}
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>{new Date(item.created_at).toLocaleDateString()}</div>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-foreground">
                {item.content}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <Link
                  className="text-foreground underline-offset-2 hover:underline"
                  to={`/agents/${item.agent_id}`}
                >
                  Open agent
                </Link>
                {item.task_id ? (
                  <Link
                    className="text-foreground underline-offset-2 hover:underline"
                    to={`/tasks/${item.task_id}`}
                  >
                    Open task
                  </Link>
                ) : null}
              </div>
            </div>
          ))}

          {insights.recent_lessons.length === 0 && (
            <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              Memory lessons will appear here after agents store their first
              experience.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  helper,
}: {
  label: string;
  value: string | number;
  helper: string;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-foreground">{value}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">{helper}</div>
    </div>
  );
}

function SummaryGroup({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<{ label: string; value: string }>;
  empty: string;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-3 space-y-2">
        {items.length > 0 ? (
          items.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between gap-3 rounded-lg bg-background/60 px-3 py-2 text-sm"
            >
              <span className="truncate text-muted-foreground">{item.label}</span>
              <span className="font-medium text-foreground">{item.value}</span>
            </div>
          ))
        ) : (
          <div className="text-sm text-muted-foreground">{empty}</div>
        )}
      </div>
    </div>
  );
}
