import { useEffect, useMemo, useState } from 'react';
import type {
  ObservabilityRecentHeartbeatRunsResponse,
  ObservabilityRecentTracesResponse,
  ObservabilitySpanItem,
  ObservabilityTraceDetailResponse,
} from '@biuro/shared';
import { ActivitySquare, Database, Filter, Radar, BrainCircuit, History } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { TraceLinkCallout } from '../components/TraceLinkCallout';
import { RetrievalInsights, type RetrievalMetricsSummary } from '../components/observability/RetrievalInsights';
import { MemoryInsights, type MemoryInsightsSummary } from '../components/observability/MemoryInsights';
import { useCompany } from '../context/CompanyContext';
import { clsx } from 'clsx';

type TraceSummary = {
  traceId: string;
  serviceName: string;
  statusCode: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  spanCount: number;
  rootSpanName: string;
  highlights: string[];
};

const statusFilters = ['all', 'ok', 'error'] as const;

function getServiceName(span: ObservabilitySpanItem, fallback: string) {
  return typeof span.attributes['service.name'] === 'string'
    ? String(span.attributes['service.name'])
    : fallback;
}

function getNormalizedStatus(statusCode: string) {
  return statusCode === '2' ? 'error' : 'ok';
}

function buildTraceSummaries(
  spans: ObservabilitySpanItem[],
  fallbackService: string
) {
  const grouped = new Map<string, ObservabilitySpanItem[]>();

  for (const span of spans) {
    const group = grouped.get(span.trace_id) ?? [];
    group.push(span);
    grouped.set(span.trace_id, group);
  }

  return Array.from(grouped.entries())
    .map(([traceId, traceSpans]): TraceSummary => {
      const sortedSpans = [...traceSpans].sort(
        (left, right) =>
          Date.parse(left.start_time) - Date.parse(right.start_time)
      );
      const rootSpan =
        sortedSpans.find((span) => !span.parent_span_id) ?? sortedSpans[0];
      const startedAt = sortedSpans[0]?.start_time ?? new Date().toISOString();
      const endedAt =
        sortedSpans[sortedSpans.length - 1]?.end_time ?? startedAt;
      const highlights = sortedSpans
        .flatMap((span) => [
          typeof span.attributes['http.route'] === 'string'
            ? String(span.attributes['http.route'])
            : null,
          typeof span.attributes['task.id'] === 'string'
            ? `task ${String(span.attributes['task.id'])}`
            : null,
          typeof span.attributes['tool.name'] === 'string'
            ? `tool ${String(span.attributes['tool.name'])}`
            : null,
          typeof span.attributes['heartbeat.status'] === 'string'
            ? `heartbeat ${String(span.attributes['heartbeat.status'])}`
            : null,
        ])
        .filter((value): value is string => Boolean(value))
        .filter(
          (value, index, collection) => collection.indexOf(value) === index
        )
        .slice(0, 3);

      return {
        traceId,
        serviceName: getServiceName(rootSpan, fallbackService),
        statusCode: rootSpan?.status_code ?? '1',
        startedAt,
        endedAt,
        durationMs: Math.max(...sortedSpans.map((span) => span.duration_ms), 0),
        spanCount: sortedSpans.length,
        rootSpanName: rootSpan?.name ?? 'trace',
        highlights,
      };
    })
    .sort(
      (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt)
    );
}

export default function ObservabilityPage() {
  const { request, loading, error, lastTrace } = useApi();
  const { selectedCompanyId } = useCompany();
  const [activeTab, setActiveTab] = useState<'traces' | 'retrieval' | 'memory'>('traces');
  
  const [heartbeatRunData, setHeartbeatRunData] =
    useState<ObservabilityRecentHeartbeatRunsResponse | null>(null);
  const [recentTraceData, setRecentTraceData] =
    useState<ObservabilityRecentTracesResponse | null>(null);
  const [traceDetail, setTraceDetail] =
    useState<ObservabilityTraceDetailResponse | null>(null);
  const [traceDetailError, setTraceDetailError] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [serviceFilter, setServiceFilter] = useState('all');
  const [statusFilter, setStatusFilter] =
    useState<(typeof statusFilters)[number]>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [retrievalMetrics, setRetrievalMetrics] = useState<RetrievalMetricsSummary | null>(null);
  const [memoryInsights, setMemoryInsights] = useState<MemoryInsightsSummary | null>(null);

  useEffect(() => {
    const loadObservabilityData = async () => {
      if (!selectedCompanyId) return;

      const [traceData, heartbeatData, retrievalData, memoryData] = await Promise.allSettled([
        request('/observability/traces/recent?limit=100', undefined, {
          suppressError: true,
          trackTrace: false,
        }) as Promise<ObservabilityRecentTracesResponse>,
        request('/observability/heartbeat-runs/recent?limit=12', undefined, {
          suppressError: true,
          trackTrace: false,
        }) as Promise<ObservabilityRecentHeartbeatRunsResponse>,
        request(`/companies/${selectedCompanyId}/retrieval-metrics?days=7`, undefined, {
          suppressError: true,
        }) as Promise<RetrievalMetricsSummary>,
        request(`/companies/${selectedCompanyId}/memory-insights?days=30`, undefined, {
          suppressError: true,
        }) as Promise<MemoryInsightsSummary>,
      ]);

      setRecentTraceData(traceData.status === 'fulfilled' ? traceData.value : null);
      setHeartbeatRunData(heartbeatData.status === 'fulfilled' ? heartbeatData.value : null);
      setRetrievalMetrics(retrievalData.status === 'fulfilled' ? retrievalData.value : null);
      setMemoryInsights(memoryData.status === 'fulfilled' ? memoryData.value : null);
    };

    void loadObservabilityData();
  }, [request, selectedCompanyId]);

  const heartbeatSummary = useMemo(() => {
    const items = heartbeatRunData?.items ?? [];
    return {
      totalRuns: items.length,
      llmFallbackRuns: items.filter((item) => item.llm_fallback_count > 0)
        .length,
      retrievalFallbackRuns: items.filter(
        (item) => item.retrieval_fallback_count > 0
      ).length,
      retrievalSkippedRuns: items.filter(
        (item) => item.retrieval_skipped_count > 0
      ).length,
    };
  }, [heartbeatRunData]);

  const traceSummaries = useMemo(
    () =>
      buildTraceSummaries(
        recentTraceData?.items ?? [],
        recentTraceData?.service ?? 'autonomiczne-biuro'
      ),
    [recentTraceData]
  );

  const availableServices = useMemo(
    () =>
      Array.from(
        new Set(traceSummaries.map((trace) => trace.serviceName))
      ).sort(),
    [traceSummaries]
  );

  const filteredTraces = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return traceSummaries.filter((trace) => {
      if (serviceFilter !== 'all' && trace.serviceName !== serviceFilter) {
        return false;
      }

      if (
        statusFilter !== 'all' &&
        getNormalizedStatus(trace.statusCode) !== statusFilter
      ) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        trace.traceId,
        trace.serviceName,
        trace.rootSpanName,
        ...trace.highlights,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [searchQuery, serviceFilter, statusFilter, traceSummaries]);

  useEffect(() => {
    if (filteredTraces.length === 0) {
      setSelectedTraceId(null);
      setTraceDetail(null);
      setTraceDetailError(null);
      return;
    }

    setSelectedTraceId((current) => {
      if (
        current &&
        filteredTraces.some((trace) => trace.traceId === current)
      ) {
        return current;
      }

      return filteredTraces[0]?.traceId ?? null;
    });
  }, [filteredTraces]);

  useEffect(() => {
    if (!selectedTraceId) {
      setTraceDetail(null);
      setTraceDetailError(null);
      return;
    }

    const loadTraceDetail = async () => {
      try {
        const data = (await request(
          `/observability/traces/${selectedTraceId}`,
          undefined,
          {
            suppressError: true,
            trackTrace: false,
          }
        )) as ObservabilityTraceDetailResponse;
        setTraceDetail(data);
        setTraceDetailError(null);
      } catch (err) {
        setTraceDetail(null);
        setTraceDetailError(
          err instanceof Error ? err.message : 'Trace detail is unavailable.'
        );
      }
    };

    void loadTraceDetail();
  }, [request, selectedTraceId]);

  const selectedTraceSummary =
    filteredTraces.find((trace) => trace.traceId === selectedTraceId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Observability</h2>
          <p className="text-sm text-muted-foreground">
            Technical performance, retrieval quality and agent memory insights.
          </p>
        </div>

        <div className="flex bg-muted/30 p-1 rounded-xl border">
          <TabButton 
            active={activeTab === 'traces'} 
            onClick={() => setActiveTab('traces')}
            icon={History}
            label="Traces & Health"
          />
          <TabButton 
            active={activeTab === 'retrieval'} 
            onClick={() => setActiveTab('retrieval')}
            icon={Database}
            label="Retrieval"
          />
          <TabButton 
            active={activeTab === 'memory'} 
            onClick={() => setActiveTab('memory')}
            icon={BrainCircuit}
            label="Memory"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {activeTab === 'traces' && (
        <>
          <section className="rounded-2xl border bg-card p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-lg font-semibold">
                  <ActivitySquare className="h-5 w-5 text-amber-600" />
                  Heartbeat runtime health
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Recent worker runs with retrieval pressure, fallback usage and
                  selected runtime.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <DetailStat
                  label="Recent runs"
                  value={String(heartbeatSummary.totalRuns)}
                />
                <DetailStat
                  label="LLM fallback runs"
                  value={String(heartbeatSummary.llmFallbackRuns)}
                />
                <DetailStat
                  label="Retrieval fallback runs"
                  value={String(heartbeatSummary.retrievalFallbackRuns)}
                />
                <DetailStat
                  label="Retrieval skipped"
                  value={String(heartbeatSummary.retrievalSkippedRuns)}
                />
              </div>
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {(heartbeatRunData?.items ?? []).map((run) => (
                <div
                  key={run.heartbeat_id}
                  className="rounded-2xl border bg-muted/10 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-foreground">
                        {run.agent_name}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {run.task_title ?? 'No task attached'}
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-wide ${
                        run.status === 'worked'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {run.status}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                      {Math.round(run.duration_ms)} ms
                    </span>
                    <span className="rounded-full border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                      ${run.cost_usd.toFixed(2)}
                    </span>
                    <span className="rounded-full border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                      {run.llm_selected_runtime ?? 'runtime n/a'}
                    </span>
                    {run.budget_capped && (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                        budget capped
                      </span>
                    )}
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <MiniMetric
                      label="LLM fallback"
                      value={String(run.llm_fallback_count)}
                    />
                    <MiniMetric
                      label="Retrieval fallback"
                      value={String(run.retrieval_fallback_count)}
                    />
                    <MiniMetric
                      label="Retrieval skipped"
                      value={String(run.retrieval_skipped_count)}
                    />
                  </div>

                  <div className="mt-3 text-xs text-muted-foreground">
                    {run.retrieval_count} retrievals ·{' '}
                    {new Date(run.created_at).toLocaleString()}
                  </div>
                </div>
              ))}

              {(heartbeatRunData?.items?.length ?? 0) === 0 && !loading && (
                <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground lg:col-span-2 xl:col-span-3">
                  No recent heartbeat runs were captured for this company yet.
                </div>
              )}
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-lg font-semibold">
                    <Radar className="h-5 w-5 text-sky-600" />
                    Recent trace sessions
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The in-app buffer currently holds {traceSummaries.length}{' '}
                    grouped trace sessions.
                  </p>
                </div>
                {lastTrace && (
                  <TraceLinkCallout
                    trace={lastTrace}
                    title="Latest API trace"
                    body="Your latest in-app request is ready for copy or Grafana handoff."
                    compact
                  />
                )}
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_180px]">
                <input
                  id="observability-search"
                  name="observabilitySearch"
                  aria-label="Search traces"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by trace, route, task or tool..."
                  className="rounded-xl border bg-background px-4 py-3 text-sm"
                />
                <select
                  aria-label="Filter traces by service"
                  value={serviceFilter}
                  onChange={(event) => setServiceFilter(event.target.value)}
                  className="rounded-xl border bg-background px-4 py-3 text-sm"
                >
                  <option value="all">Service: all</option>
                  {availableServices.map((service) => (
                    <option key={service} value={service}>
                      Service: {service}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter traces by status"
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(
                      event.target.value as (typeof statusFilters)[number]
                    )
                  }
                  className="rounded-xl border bg-background px-4 py-3 text-sm"
                >
                  {statusFilters.map((status) => (
                    <option key={status} value={status}>
                      Status: {status}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-5 space-y-3">
                {filteredTraces.map((trace) => {
                  const isSelected = trace.traceId === selectedTraceId;
                  return (
                    <button
                      key={trace.traceId}
                      type="button"
                      onClick={() => setSelectedTraceId(trace.traceId)}
                      className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'bg-muted/10 hover:bg-accent'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="font-medium text-foreground">
                            {trace.rootSpanName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {trace.serviceName}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-wide ${
                              getNormalizedStatus(trace.statusCode) === 'error'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {getNormalizedStatus(trace.statusCode)}
                          </span>
                          <code className="rounded bg-background px-2 py-1 text-[11px] text-foreground">
                            {trace.traceId.slice(0, 8)}...{trace.traceId.slice(-8)}
                          </code>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                        <span>{trace.spanCount} spans</span>
                        <span>{Math.round(trace.durationMs)} ms</span>
                        <span>{new Date(trace.startedAt).toLocaleString()}</span>
                      </div>
                      {trace.highlights.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {trace.highlights.map((highlight) => (
                            <span
                              key={highlight}
                              className="rounded-full border bg-background px-2 py-1 text-[11px] text-muted-foreground"
                            >
                              {highlight}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}

                {filteredTraces.length === 0 && !loading && (
                  <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                    No traces match the current filters.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 text-lg font-semibold">
                <ActivitySquare className="h-5 w-5 text-emerald-600" />
                Trace detail
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Span-by-span view for the selected trace session.
              </p>

              {selectedTraceSummary && (
                <div className="mt-4">
                  <TraceLinkCallout
                    trace={{
                      traceId: selectedTraceSummary.traceId,
                      path: selectedTraceSummary.rootSpanName,
                      method: 'TRACE',
                      status:
                        getNormalizedStatus(selectedTraceSummary.statusCode) ===
                        'error'
                          ? 500
                          : 200,
                      capturedAt: selectedTraceSummary.startedAt,
                    }}
                    title="Selected trace"
                    body={`Inspect ${selectedTraceSummary.serviceName} in Grafana or copy the trace ID for external debugging.`}
                  />
                </div>
              )}

              {traceDetailError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {traceDetailError}
                </div>
              )}

              <div className="mt-5 space-y-4">
                {traceDetail ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <DetailStat
                        label="Spans"
                        value={String(traceDetail.summary.span_count)}
                      />
                      <DetailStat
                        label="Duration"
                        value={`${Math.round(traceDetail.summary.duration_ms)} ms`}
                      />
                      <DetailStat label="Service" value={traceDetail.service} />
                    </div>

                    <div className="rounded-2xl border bg-muted/10 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Filter className="h-4 w-4 text-muted-foreground" />
                        Timeline
                      </div>
                      <div className="mt-4 space-y-3">
                        {traceDetail.items.map((span) => (
                          <div
                            key={span.span_id}
                            className="rounded-xl border bg-background p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <div className="font-medium text-foreground">
                                  {span.name}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {new Date(span.start_time).toLocaleString()}
                                </div>
                              </div>
                              <div className="text-right text-xs text-muted-foreground">
                                <div>{Math.round(span.duration_ms)} ms</div>
                                <div>{getNormalizedStatus(span.status_code)}</div>
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {extractSpanTags(span.attributes).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-full border bg-muted px-2 py-1 text-[11px] text-muted-foreground"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                    Select a trace from the list to inspect its span timeline.
                  </div>
                )}
              </div>
            </section>
          </div>
        </>
      )}

      {activeTab === 'retrieval' && (
        <RetrievalInsights metrics={retrievalMetrics} />
      )}

      {activeTab === 'memory' && (
        <MemoryInsights insights={memoryInsights} />
      )}
    </div>
  );
}

function extractSpanTags(attributes: Record<string, unknown>) {
  return [
    'http.route',
    'task.id',
    'tool.name',
    'heartbeat.status',
    'company.id',
  ]
    .map((key) => {
      const value = attributes[key];
      return typeof value === 'string' && value.length > 0
        ? `${key}: ${value}`
        : null;
    })
    .filter((value): value is string => Boolean(value))
    .slice(0, 4);
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-base font-semibold text-foreground">{value}</div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all",
        active 
          ? "bg-background text-foreground shadow-sm" 
          : "text-muted-foreground hover:text-foreground hover:bg-background/50"
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}
