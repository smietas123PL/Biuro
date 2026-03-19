import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';
import { TraceLinkCallout } from '../components/TraceLinkCallout';
import type { ApiTraceSnapshot } from '../hooks/useApi';

type AuditLogItem = {
  id: string;
  action: string;
  agent_id?: string | null;
  details?: Record<string, unknown> | null;
  created_at: string;
};

type AuditRoutingDetails = {
  selected_runtime: string;
  selected_model: string;
  attempts: Array<{
    runtime: string;
    model: string;
    status: 'success' | 'fallback' | 'failed';
    reason?: string;
  }>;
};

type AuditLogResponse = {
  items: AuditLogItem[];
  has_more: boolean;
  next_cursor: {
    created_at: string;
    id: string;
  } | null;
};

type RecentTraceResponse = {
  items: Array<{
    trace_id: string;
    name: string;
    start_time: string;
    status_code: string;
  }>;
};

type TemplatePreviewDetails = {
  preset_id: string;
  preset_name: string;
  requested_by_user_id?: string | null;
  requested_by_role?: string | null;
  changes?: {
    total_new_records?: number;
    tools_to_update?: number;
  };
  projected_counts?: {
    goals?: number;
    agents?: number;
    tools?: number;
    policies?: number;
    budgets?: number;
  };
  sample_changes?: {
    agents_to_add?: string[];
    tools_to_create?: string[];
    tools_to_update?: string[];
  };
};

type TemplateImportDetails = {
  source?: string;
  preset_id?: string;
  preset_name?: string;
  requested_by_user_id?: string | null;
  requested_by_role?: string | null;
  preserve_company_identity?: boolean;
  changes?: {
    goalsImported?: number;
    toolsImported?: number;
    policiesImported?: number;
    agentsImported?: number;
    budgetsImported?: number;
  };
};

type AuditFilter = {
  id: string;
  label: string;
  action?: string;
  actionPrefix?: string;
};

type AuditRange = {
  id: string;
  label: string;
  days: number | null;
};

const auditFilters: AuditFilter[] = [
  { id: 'all', label: 'All Events' },
  { id: 'templates', label: 'Template Events', actionPrefix: 'template.' },
  { id: 'template-previews', label: 'Template Previews', action: 'template.previewed' },
  { id: 'template-imports', label: 'Template Imports', action: 'template.imported' },
];

const auditRanges: AuditRange[] = [
  { id: '24h', label: 'Last 24h', days: 1 },
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: 'all-time', label: 'All time', days: null },
];

function buildAuditLogQuery(
  filter: AuditFilter,
  range: AuditRange,
  cursor?: AuditLogResponse['next_cursor']
) {
  const params = new URLSearchParams();
  params.set('limit', '50');

  if (filter.action) {
    params.set('action', filter.action);
  }

  if (filter.actionPrefix) {
    params.set('action_prefix', filter.actionPrefix);
  }

  if (range.days !== null) {
    const from = new Date();
    from.setDate(from.getDate() - range.days);
    params.set('from', from.toISOString());
    params.set('to', new Date().toISOString());
  }

  if (cursor) {
    params.set('cursor_created_at', cursor.created_at);
    params.set('cursor_id', cursor.id);
  }

  return `?${params.toString()}`;
}

function getAuditRouting(details?: Record<string, unknown> | null): AuditRoutingDetails | null {
  const routing = details?.llm_routing;
  if (!routing || typeof routing !== 'object') {
    return null;
  }

  const selectedRuntime = (routing as { selected_runtime?: unknown }).selected_runtime;
  const selectedModel = (routing as { selected_model?: unknown }).selected_model;
  const attempts = (routing as { attempts?: unknown }).attempts;
  if (typeof selectedRuntime !== 'string' || typeof selectedModel !== 'string') {
    return null;
  }

  return {
    selected_runtime: selectedRuntime,
    selected_model: selectedModel,
    attempts: Array.isArray(attempts)
      ? attempts.filter((attempt) => attempt && typeof attempt === 'object')
        .map((attempt) => ({
          runtime: String((attempt as { runtime?: unknown }).runtime ?? 'unknown'),
          model: String((attempt as { model?: unknown }).model ?? 'unknown'),
          status: ((attempt as { status?: unknown }).status as AuditRoutingDetails['attempts'][number]['status']) ?? 'failed',
          reason: typeof (attempt as { reason?: unknown }).reason === 'string'
            ? String((attempt as { reason?: unknown }).reason)
            : undefined,
        }))
      : [],
  };
}

export default function AuditLogPage() {
  const { request, loading } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [recentTraces, setRecentTraces] = useState<ApiTraceSnapshot[]>([]);
  const [recentTraceError, setRecentTraceError] = useState<string | null>(null);
  const [activeFilterId, setActiveFilterId] = useState<AuditFilter['id']>('all');
  const [activeRangeId, setActiveRangeId] = useState<AuditRange['id']>('7d');
  const [nextCursor, setNextCursor] = useState<AuditLogResponse['next_cursor']>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadLogs = async (cursor?: AuditLogResponse['next_cursor'], append = false) => {
    if (!selectedCompanyId) {
      setLogs([]);
      setHasMore(false);
      setNextCursor(null);
      return;
    }

    const activeFilter = auditFilters.find((filter) => filter.id === activeFilterId) ?? auditFilters[0];
    const activeRange = auditRanges.find((range) => range.id === activeRangeId) ?? auditRanges[1];
    const query = buildAuditLogQuery(activeFilter, activeRange, cursor);
    const data = (await request(`/companies/${selectedCompanyId}/audit-log${query}`)) as AuditLogResponse;

    setLogs((current) => (append ? [...current, ...data.items] : data.items));
    setHasMore(data.has_more);
    setNextCursor(data.next_cursor);
  };

  useEffect(() => {
    void loadLogs();
  }, [activeFilterId, activeRangeId, selectedCompanyId]);

  useEffect(() => {
    const loadRecentTraces = async () => {
      if (!selectedCompanyId) {
        setRecentTraces([]);
        setRecentTraceError(null);
        return;
      }

      try {
        const data = (await request('/observability/traces/recent?limit=6', undefined, {
          suppressError: true,
          trackTrace: false,
        })) as RecentTraceResponse;

        setRecentTraces(
          (data.items ?? []).map((trace) => ({
            traceId: trace.trace_id,
            path: trace.name,
            method: 'TRACE',
            status: Number(trace.status_code) || 200,
            capturedAt: trace.start_time,
          }))
        );
        setRecentTraceError(null);
      } catch (err) {
        setRecentTraces([]);
        setRecentTraceError(err instanceof Error ? err.message : 'Recent traces are unavailable.');
      }
    };

    void loadRecentTraces();
  }, [request, selectedCompanyId]);

  if (!selectedCompany) {
    return <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">Choose a company to inspect the audit log.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Audit Log</h2>
        <p className="text-sm text-muted-foreground">Recent events for {selectedCompany.name}</p>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {auditFilters.map((filter) => (
            <button
              key={filter.id}
              onClick={() => setActiveFilterId(filter.id)}
              className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                filter.id === activeFilterId
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-accent'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {auditRanges.map((range) => (
            <button
              key={range.id}
              onClick={() => setActiveRangeId(range.id)}
              className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                range.id === activeRangeId
                  ? 'border-foreground bg-foreground text-background'
                  : 'bg-card text-muted-foreground hover:bg-accent'
              }`}
            >
              {range.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="divide-y">
            {logs.map((log) => (
              <AuditLogRow key={log.id} log={log} />
            ))}
            {logs.length === 0 && !loading && (
              <div className="p-12 text-center italic text-muted-foreground">
                No events logged for this filter and date range yet.
              </div>
            )}
          </div>

          {hasMore && (
            <div className="border-t p-4">
              <button
                onClick={() => {
                  setLoadingMore(true);
                  void loadLogs(nextCursor, true).finally(() => setLoadingMore(false));
                }}
                disabled={loadingMore || !nextCursor}
                className="w-full rounded-md border bg-background px-4 py-3 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingMore ? 'Loading more...' : 'Load more'}
              </button>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Recent Traces</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Fresh spans from the in-app observability buffer for quick debugging.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {recentTraces.map((trace) => (
                <TraceLinkCallout
                  key={trace.traceId}
                  trace={trace}
                  title={trace.path}
                  body={`Captured ${new Date(trace.capturedAt).toLocaleString()} with status ${trace.status}.`}
                  compact
                />
              ))}

              {recentTraces.length === 0 && !recentTraceError && (
                <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                  Recent traces will appear here once the API records fresh spans for your session.
                </div>
              )}

              {recentTraceError && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  {recentTraceError}
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function AuditLogRow({ log }: { log: AuditLogItem }) {
  const routing = getAuditRouting(log.details);
  const templatePreview = log.action === 'template.previewed'
    ? (log.details as TemplatePreviewDetails | null)
    : null;
  const templateImport = log.action === 'template.imported'
    ? (log.details as TemplateImportDetails | null)
    : null;

  return (
    <div className="flex gap-4 p-4 transition-colors hover:bg-accent/30">
      <div className="mt-1">
        <History className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold">{log.action}</div>
            <div className="text-xs text-muted-foreground">
              {templatePreview
                ? `Preview snapshot for preset ${templatePreview.preset_name}`
                : templateImport
                  ? `Import event from ${templateImport.source === 'preset' ? `preset ${templateImport.preset_name}` : 'custom template'}`
                  : 'Operational event'}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {new Date(log.created_at).toLocaleString()}
          </div>
        </div>

        {templatePreview ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                requested by {templatePreview.requested_by_role || 'unknown role'}
              </span>
              <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                {templatePreview.changes?.total_new_records ?? 0} new rows expected
              </span>
              <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                {templatePreview.changes?.tools_to_update ?? 0} tool updates
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <AuditMetricBlock
                title="Projected counts"
                lines={[
                  `${templatePreview.projected_counts?.agents ?? 0} agents`,
                  `${templatePreview.projected_counts?.goals ?? 0} goals`,
                  `${templatePreview.projected_counts?.tools ?? 0} tools`,
                  `${templatePreview.projected_counts?.policies ?? 0} policies`,
                ]}
              />
              <AuditMetricBlock
                title="Sample changes"
                lines={[
                  `Agents: ${(templatePreview.sample_changes?.agents_to_add ?? []).join(', ') || 'none'}`,
                  `Create tools: ${(templatePreview.sample_changes?.tools_to_create ?? []).join(', ') || 'none'}`,
                  `Update tools: ${(templatePreview.sample_changes?.tools_to_update ?? []).join(', ') || 'none'}`,
                ]}
              />
            </div>
          </div>
        ) : templateImport ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                requested by {templateImport.requested_by_role || 'unknown role'}
              </span>
              <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                preserve identity: {templateImport.preserve_company_identity ? 'yes' : 'no'}
              </span>
              <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                source: {templateImport.source || 'unknown'}
              </span>
            </div>

            <AuditMetricBlock
              title="Imported records"
              lines={[
                `${templateImport.changes?.agentsImported ?? 0} agents`,
                `${templateImport.changes?.goalsImported ?? 0} goals`,
                `${templateImport.changes?.toolsImported ?? 0} tools`,
                `${templateImport.changes?.policiesImported ?? 0} policies`,
                `${templateImport.changes?.budgetsImported ?? 0} budgets`,
              ]}
            />
          </div>
        ) : (
          <>
            <div className="text-sm text-muted-foreground">
              Agent: <span className="text-foreground">{log.agent_id?.split('-')[0] || 'System'}</span>
            </div>
            {routing ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-primary/10 px-3 py-1 text-primary">
                    Provider {routing.selected_runtime}
                  </span>
                  <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                    Model {routing.selected_model}
                  </span>
                  <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                    Fallbacks {routing.attempts.filter((attempt) => attempt.status === 'fallback').length}
                  </span>
                </div>

                <AuditMetricBlock
                  title="LLM routing"
                  lines={routing.attempts.map((attempt) => (
                    `${attempt.runtime} / ${attempt.model} • ${attempt.status}${attempt.reason ? ` • ${attempt.reason}` : ''}`
                  ))}
                />
              </div>
            ) : null}
            {log.details && (
              <pre className="mt-2 max-h-24 overflow-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(log.details, null, 2)}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AuditMetricBlock({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-2xl border bg-muted/20 p-4">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-3 space-y-2">
        {lines.map((line) => (
          <div key={line} className="text-sm text-muted-foreground">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
