import { ActivitySquare, Database } from 'lucide-react';

export type RetrievalMetricsSummary = {
  range_days: number;
  totals: {
    searches: number;
    knowledge_searches: number;
    memory_searches: number;
    avg_latency_ms: number;
    avg_result_count: number;
    avg_overlap_count: number;
    zero_result_rate_pct: number;
  };
  by_source: Array<{
    embedding_source: string;
    total: number;
  }>;
  by_consumer: Array<{
    consumer: string;
    total: number;
  }>;
  recent: Array<{
    scope: string;
    consumer: string;
    result_count: number;
    overlap_count: number;
    top_distance?: number | null;
    embedding_source: string;
    created_at: string;
  }>;
};

interface RetrievalInsightsProps {
  metrics: RetrievalMetricsSummary | null;
}

export function RetrievalInsights({ metrics }: RetrievalInsightsProps) {
  if (!metrics) return null;

  const topSources = [...metrics.by_source]
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);
  const topConsumers = [...metrics.by_consumer]
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
                <Database className="w-5 h-5 text-primary" />
                Retrieval Quality
            </h3>
            <p className="text-sm text-muted-foreground">
              Performance of vector and lexical lookups over the last{' '}
              {metrics.range_days} days.
            </p>
          </div>
          <span className="rounded-full border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
            {metrics.totals.searches} searches
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Zero-result rate"
            value={`${metrics.totals.zero_result_rate_pct.toFixed(1)}%`}
            helper="Lower is better for healthy retrieval coverage"
          />
          <Metric
            label="Avg latency"
            value={`${Math.round(metrics.totals.avg_latency_ms)}ms`}
            helper="Mean end-to-end retrieval time"
          />
          <Metric
            label="Avg results"
            value={metrics.totals.avg_result_count.toFixed(1)}
            helper="Average number of returned candidates"
          />
          <Metric
            label="Avg overlap"
            value={metrics.totals.avg_overlap_count.toFixed(1)}
            helper="How often lexical and vector hits agree"
          />
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <SummaryGroup
            title="Embedding sources"
            empty="No retrieval data yet."
            items={topSources.map((item) => ({
              label: item.embedding_source,
              value: `${item.total}`,
            }))}
          />
          <SummaryGroup
            title="Top consumers"
            empty="No active retrieval consumers yet."
            items={topConsumers.map((item) => ({
              label: item.consumer.replace(/_/g, ' '),
              value: `${item.total}`,
            }))}
          />
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold flex items-center gap-2">
            <ActivitySquare className="w-5 h-5 text-primary" />
            Recent Retrievals
        </h3>
        <div className="mt-4 space-y-3">
          {metrics.recent.map((item, index) => (
            <div
              key={`${item.created_at}-${item.consumer}-${index}`}
              className="rounded-xl border bg-muted/20 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium text-foreground">
                  {item.scope} - {item.consumer.replace(/_/g, ' ')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(item.created_at).toLocaleString()}
                </div>
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                {item.result_count} results, overlap {item.overlap_count},
                source {item.embedding_source}
                {typeof item.top_distance === 'number'
                  ? `, top distance ${item.top_distance.toFixed(3)}`
                  : ''}
              </div>
            </div>
          ))}

          {metrics.recent.length === 0 && (
            <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              Retrieval metrics will appear after the first knowledge or
              memory lookups.
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
