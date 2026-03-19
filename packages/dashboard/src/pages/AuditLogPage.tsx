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

type NLCommandPlannerDetails = {
  mode: 'llm' | 'rules';
  runtime?: string;
  model?: string;
  attempts?: Array<{
    runtime: string;
    model: string;
    status: 'success' | 'fallback' | 'failed';
    reason?: string;
  }>;
  fallback_reason?:
    | 'llm_unavailable'
    | 'llm_failed'
    | 'invalid_llm_plan'
    | null;
};

type PlannerAttemptStatus = 'success' | 'fallback' | 'failed';

type NLCommandAuditDetails = {
  input?: string;
  source?: 'llm' | 'rules';
  can_execute?: boolean;
  action_count?: number;
  action_types?: string[];
  planner?: NLCommandPlannerDetails;
  user_id?: string | null;
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

type ControlPanelFacet = {
  id: 'all' | 'llm-only' | 'rules-fallback' | 'executable' | 'failed-planning';
  label: string;
};

const auditFilters: AuditFilter[] = [
  { id: 'all', label: 'All Events' },
  { id: 'control-panel', label: 'Control Panel', actionPrefix: 'nl_command.' },
  { id: 'templates', label: 'Template Events', actionPrefix: 'template.' },
  {
    id: 'template-previews',
    label: 'Template Previews',
    action: 'template.previewed',
  },
  {
    id: 'template-imports',
    label: 'Template Imports',
    action: 'template.imported',
  },
];

const auditRanges: AuditRange[] = [
  { id: '24h', label: 'Last 24h', days: 1 },
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: 'all-time', label: 'All time', days: null },
];

const controlPanelFacets: ControlPanelFacet[] = [
  { id: 'all', label: 'All Plans' },
  { id: 'llm-only', label: 'LLM Only' },
  { id: 'rules-fallback', label: 'Rules Fallback' },
  { id: 'executable', label: 'Executable' },
  { id: 'failed-planning', label: 'Failed Planning' },
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

function getRuntimeLabel(runtime?: string) {
  if (runtime === 'claude') {
    return 'Claude';
  }

  if (runtime === 'openai') {
    return 'OpenAI';
  }

  if (runtime === 'gemini') {
    return 'Gemini';
  }

  return runtime ?? 'Rules';
}

function getAuditRouting(
  details?: Record<string, unknown> | null
): AuditRoutingDetails | null {
  const routing = details?.llm_routing;
  if (!routing || typeof routing !== 'object') {
    return null;
  }

  const selectedRuntime = (routing as { selected_runtime?: unknown })
    .selected_runtime;
  const selectedModel = (routing as { selected_model?: unknown })
    .selected_model;
  const attempts = (routing as { attempts?: unknown }).attempts;
  if (
    typeof selectedRuntime !== 'string' ||
    typeof selectedModel !== 'string'
  ) {
    return null;
  }

  return {
    selected_runtime: selectedRuntime,
    selected_model: selectedModel,
    attempts: Array.isArray(attempts)
      ? attempts
          .filter((attempt) => attempt && typeof attempt === 'object')
          .map((attempt) => ({
            runtime: String(
              (attempt as { runtime?: unknown }).runtime ?? 'unknown'
            ),
            model: String((attempt as { model?: unknown }).model ?? 'unknown'),
            status:
              ((attempt as { status?: unknown })
                .status as AuditRoutingDetails['attempts'][number]['status']) ??
              'failed',
            reason:
              typeof (attempt as { reason?: unknown }).reason === 'string'
                ? String((attempt as { reason?: unknown }).reason)
                : undefined,
          }))
      : [],
  };
}

function getNLCommandDetails(
  details?: Record<string, unknown> | null
): NLCommandAuditDetails | null {
  if (!details || typeof details !== 'object') {
    return null;
  }

  const plannerRaw = (details as { planner?: unknown }).planner;
  const planner =
    plannerRaw && typeof plannerRaw === 'object'
      ? {
          mode:
            ((plannerRaw as { mode?: unknown })
              .mode as NLCommandPlannerDetails['mode']) ?? 'rules',
          runtime:
            typeof (plannerRaw as { runtime?: unknown }).runtime === 'string'
              ? String((plannerRaw as { runtime?: unknown }).runtime)
              : undefined,
          model:
            typeof (plannerRaw as { model?: unknown }).model === 'string'
              ? String((plannerRaw as { model?: unknown }).model)
              : undefined,
          attempts: Array.isArray(
            (plannerRaw as { attempts?: unknown }).attempts
          )
            ? ((plannerRaw as { attempts?: unknown }).attempts as unknown[])
                .filter((attempt) => attempt && typeof attempt === 'object')
                .map((attempt) => ({
                  runtime: String(
                    (attempt as { runtime?: unknown }).runtime ?? 'unknown'
                  ),
                  model: String(
                    (attempt as { model?: unknown }).model ?? 'unknown'
                  ),
                  status:
                    ((attempt as { status?: unknown })
                      .status as PlannerAttemptStatus) ?? 'failed',
                  reason:
                    typeof (attempt as { reason?: unknown }).reason === 'string'
                      ? String((attempt as { reason?: unknown }).reason)
                      : undefined,
                }))
            : undefined,
          fallback_reason:
            ((plannerRaw as { fallback_reason?: unknown })
              .fallback_reason as NLCommandPlannerDetails['fallback_reason']) ??
            null,
        }
      : undefined;

  return {
    input:
      typeof (details as { input?: unknown }).input === 'string'
        ? String((details as { input?: unknown }).input)
        : undefined,
    source:
      ((details as { source?: unknown })
        .source as NLCommandAuditDetails['source']) ?? undefined,
    can_execute:
      typeof (details as { can_execute?: unknown }).can_execute === 'boolean'
        ? Boolean((details as { can_execute?: unknown }).can_execute)
        : undefined,
    action_count:
      typeof (details as { action_count?: unknown }).action_count === 'number'
        ? Number((details as { action_count?: unknown }).action_count)
        : undefined,
    action_types: Array.isArray(
      (details as { action_types?: unknown }).action_types
    )
      ? ((details as { action_types?: unknown }).action_types as unknown[]).map(
          (item) => String(item)
        )
      : undefined,
    planner,
    user_id:
      typeof (details as { user_id?: unknown }).user_id === 'string'
        ? String((details as { user_id?: unknown }).user_id)
        : null,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return <>{text}</>;
  }

  const matcher = new RegExp(`(${escapeRegExp(normalizedQuery)})`, 'ig');
  const parts = text.split(matcher);
  const normalizedNeedle = normalizedQuery.toLowerCase();

  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === normalizedNeedle ? (
          <mark
            key={`${part}-${index}`}
            className="rounded bg-amber-200/70 px-1 text-foreground"
          >
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        )
      )}
    </>
  );
}

function matchesControlPanelFacet(
  log: AuditLogItem,
  facetId: ControlPanelFacet['id']
) {
  if (facetId === 'all') {
    return true;
  }

  const details =
    log.action === 'nl_command.planned'
      ? getNLCommandDetails(log.details)
      : null;
  if (!details) {
    return false;
  }

  if (facetId === 'llm-only') {
    return details.source === 'llm' && !details.planner?.fallback_reason;
  }

  if (facetId === 'rules-fallback') {
    return (
      details.source === 'rules' && Boolean(details.planner?.fallback_reason)
    );
  }

  if (facetId === 'executable') {
    return details.can_execute === true;
  }

  if (facetId === 'failed-planning') {
    return details.can_execute === false;
  }

  return true;
}

export default function AuditLogPage() {
  const { request, loading } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [controlPanelLogs, setControlPanelLogs] = useState<AuditLogItem[]>([]);
  const [recentTraces, setRecentTraces] = useState<ApiTraceSnapshot[]>([]);
  const [recentTraceError, setRecentTraceError] = useState<string | null>(null);
  const [controlPanelError, setControlPanelError] = useState<string | null>(
    null
  );
  const [activeFilterId, setActiveFilterId] =
    useState<AuditFilter['id']>('all');
  const [activeRangeId, setActiveRangeId] = useState<AuditRange['id']>('7d');
  const [activeControlPanelFacetId, setActiveControlPanelFacetId] =
    useState<ControlPanelFacet['id']>('all');
  const [controlPanelSearch, setControlPanelSearch] = useState('');
  const [nextCursor, setNextCursor] =
    useState<AuditLogResponse['next_cursor']>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadLogs = async (
    cursor?: AuditLogResponse['next_cursor'],
    append = false
  ) => {
    if (!selectedCompanyId) {
      setLogs([]);
      setHasMore(false);
      setNextCursor(null);
      return;
    }

    const activeFilter =
      auditFilters.find((filter) => filter.id === activeFilterId) ??
      auditFilters[0];
    const activeRange =
      auditRanges.find((range) => range.id === activeRangeId) ?? auditRanges[1];
    const query = buildAuditLogQuery(activeFilter, activeRange, cursor);
    const data = (await request(
      `/companies/${selectedCompanyId}/audit-log${query}`
    )) as AuditLogResponse;

    setLogs((current) => (append ? [...current, ...data.items] : data.items));
    setHasMore(data.has_more);
    setNextCursor(data.next_cursor);
  };

  useEffect(() => {
    void loadLogs();
  }, [activeFilterId, activeRangeId, selectedCompanyId]);

  useEffect(() => {
    if (
      activeFilterId !== 'control-panel' &&
      activeControlPanelFacetId !== 'all'
    ) {
      setActiveControlPanelFacetId('all');
    }
  }, [activeControlPanelFacetId, activeFilterId]);

  useEffect(() => {
    if (activeFilterId !== 'control-panel' && controlPanelSearch) {
      setControlPanelSearch('');
    }
  }, [activeFilterId, controlPanelSearch]);

  useEffect(() => {
    const loadRecentTraces = async () => {
      if (!selectedCompanyId) {
        setRecentTraces([]);
        setRecentTraceError(null);
        return;
      }

      try {
        const data = (await request(
          '/observability/traces/recent?limit=6',
          undefined,
          {
            suppressError: true,
            trackTrace: false,
          }
        )) as RecentTraceResponse;

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
        setRecentTraceError(
          err instanceof Error ? err.message : 'Recent traces are unavailable.'
        );
      }
    };

    void loadRecentTraces();
  }, [request, selectedCompanyId]);

  useEffect(() => {
    const loadControlPanelActivity = async () => {
      if (!selectedCompanyId) {
        setControlPanelLogs([]);
        setControlPanelError(null);
        return;
      }

      try {
        const data = (await request(
          `/companies/${selectedCompanyId}/audit-log?limit=5&action_prefix=nl_command.`,
          undefined,
          { suppressError: true, trackTrace: false }
        )) as AuditLogResponse;
        setControlPanelLogs(data.items ?? []);
        setControlPanelError(null);
      } catch (err) {
        setControlPanelLogs([]);
        setControlPanelError(
          err instanceof Error
            ? err.message
            : 'Control Panel activity is unavailable.'
        );
      }
    };

    void loadControlPanelActivity();
  }, [request, selectedCompanyId]);

  if (!selectedCompany) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
        Choose a company to inspect the audit log.
      </div>
    );
  }

  const normalizedControlPanelSearch = controlPanelSearch.trim().toLowerCase();
  const matchesControlPanelSearch = (log: AuditLogItem) => {
    if (!normalizedControlPanelSearch) {
      return true;
    }

    const details =
      log.action === 'nl_command.planned'
        ? getNLCommandDetails(log.details)
        : null;
    const haystack = [
      log.action,
      details?.input,
      details?.source,
      details?.planner?.mode,
      details?.planner?.runtime,
      details?.planner?.model,
      details?.planner?.fallback_reason,
      ...(details?.action_types ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedControlPanelSearch);
  };

  const filteredLogs =
    activeFilterId === 'control-panel'
      ? logs.filter(
          (log) =>
            matchesControlPanelFacet(log, activeControlPanelFacetId) &&
            matchesControlPanelSearch(log)
        )
      : logs;
  const filteredControlPanelLogs = controlPanelLogs.filter(
    matchesControlPanelSearch
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Audit Log</h2>
        <p className="text-sm text-muted-foreground">
          Recent events for {selectedCompany.name}
        </p>
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

        {activeFilterId === 'control-panel' && (
          <>
            <div className="flex flex-wrap gap-2">
              {controlPanelFacets.map((facet) => {
                const count = logs.filter((log) =>
                  matchesControlPanelFacet(log, facet.id)
                ).length;
                return (
                  <button
                    key={facet.id}
                    onClick={() => setActiveControlPanelFacetId(facet.id)}
                    className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                      facet.id === activeControlPanelFacetId
                        ? 'border-sky-600 bg-sky-600 text-white'
                        : 'bg-card text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {facet.label} ({count})
                  </button>
                );
              })}
            </div>

            <div className="max-w-md">
              <input
                type="search"
                value={controlPanelSearch}
                onChange={(event) => setControlPanelSearch(event.target.value)}
                placeholder="Search Control Panel commands..."
                className="w-full rounded-xl border bg-card px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-sky-500"
              />
            </div>
          </>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="divide-y">
            {filteredLogs.map((log) => (
              <AuditLogRow
                key={log.id}
                log={log}
                controlPanelSearch={
                  activeFilterId === 'control-panel' ? controlPanelSearch : ''
                }
              />
            ))}
            {filteredLogs.length === 0 && !loading && (
              <div className="p-12 text-center italic text-muted-foreground">
                {activeFilterId === 'control-panel'
                  ? 'No Control Panel events match this facet and date range yet.'
                  : 'No events logged for this filter and date range yet.'}
              </div>
            )}
          </div>

          {hasMore && (
            <div className="border-t p-4">
              <button
                onClick={() => {
                  setLoadingMore(true);
                  void loadLogs(nextCursor, true).finally(() =>
                    setLoadingMore(false)
                  );
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
            <div>
              <h3 className="text-lg font-semibold">Control Panel Activity</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Latest natural-language planning requests, including runtime
                source and fallback status.
              </p>
            </div>

            <div className="mt-4 space-y-3">
              {filteredControlPanelLogs.map((log) => {
                const details = getNLCommandDetails(log.details);
                const planner = details?.planner;
                return (
                  <div
                    key={log.id}
                    className="rounded-2xl border bg-muted/20 p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700">
                        {planner?.mode === 'llm' && planner.runtime
                          ? `Planned by ${getRuntimeLabel(planner.runtime)}`
                          : 'Planned by Rules'}
                      </span>
                      {planner?.fallback_reason && (
                        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                          Fallback: {planner.fallback_reason}
                        </span>
                      )}
                      {typeof details?.action_count === 'number' && (
                        <span className="rounded-full bg-background px-3 py-1 text-xs text-muted-foreground">
                          {details.action_count} steps
                        </span>
                      )}
                    </div>

                    <div className="mt-3 text-sm font-medium text-foreground">
                      {details?.input ? (
                        <HighlightedText
                          text={details.input}
                          query={controlPanelSearch}
                        />
                      ) : (
                        'Natural language control request'
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </div>
                  </div>
                );
              })}

              {filteredControlPanelLogs.length === 0 && !controlPanelError && (
                <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                  {normalizedControlPanelSearch
                    ? 'No Control Panel activity matches this search yet.'
                    : 'Natural-language planning events will appear here after the first Control Panel request.'}
                </div>
              )}

              {controlPanelError && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  {controlPanelError}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">Recent Traces</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Fresh spans from the in-app observability buffer for quick
                  debugging.
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
                  Recent traces will appear here once the API records fresh
                  spans for your session.
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

function AuditLogRow({
  log,
  controlPanelSearch = '',
}: {
  log: AuditLogItem;
  controlPanelSearch?: string;
}) {
  const routing = getAuditRouting(log.details);
  const nlCommand =
    log.action === 'nl_command.planned'
      ? getNLCommandDetails(log.details)
      : null;
  const templatePreview =
    log.action === 'template.previewed'
      ? (log.details as TemplatePreviewDetails | null)
      : null;
  const templateImport =
    log.action === 'template.imported'
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
                  : nlCommand
                    ? 'Natural language Control Panel request'
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
                requested by{' '}
                {templatePreview.requested_by_role || 'unknown role'}
              </span>
              <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                {templatePreview.changes?.total_new_records ?? 0} new rows
                expected
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
                requested by{' '}
                {templateImport.requested_by_role || 'unknown role'}
              </span>
              <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                preserve identity:{' '}
                {templateImport.preserve_company_identity ? 'yes' : 'no'}
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
        ) : nlCommand ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-sky-100 px-3 py-1 font-medium text-sky-700">
                {nlCommand.planner?.mode === 'llm' && nlCommand.planner.runtime
                  ? `Planned by ${getRuntimeLabel(nlCommand.planner.runtime)}`
                  : 'Planned by Rules'}
              </span>
              {typeof nlCommand.action_count === 'number' && (
                <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                  {nlCommand.action_count} steps
                </span>
              )}
              <span className="rounded-full bg-muted px-3 py-1 text-muted-foreground">
                executable: {nlCommand.can_execute ? 'yes' : 'no'}
              </span>
              {nlCommand.planner?.fallback_reason && (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">
                  fallback: {nlCommand.planner.fallback_reason}
                </span>
              )}
            </div>

            {nlCommand.input && (
              <div className="rounded-2xl border bg-muted/20 px-4 py-3 text-sm text-foreground">
                <HighlightedText
                  text={nlCommand.input}
                  query={controlPanelSearch}
                />
              </div>
            )}

            {nlCommand.planner?.attempts &&
              nlCommand.planner.attempts.length > 0 && (
                <AuditMetricBlock
                  title="Planner routing"
                  lines={nlCommand.planner.attempts.map(
                    (attempt) =>
                      `${attempt.runtime} / ${attempt.model} | ${attempt.status}${attempt.reason ? ` | ${attempt.reason}` : ''}`
                  )}
                />
              )}
          </div>
        ) : (
          <>
            <div className="text-sm text-muted-foreground">
              Agent:{' '}
              <span className="text-foreground">
                {log.agent_id?.split('-')[0] || 'System'}
              </span>
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
                    Fallbacks{' '}
                    {
                      routing.attempts.filter(
                        (attempt) => attempt.status === 'fallback'
                      ).length
                    }
                  </span>
                </div>

                <AuditMetricBlock
                  title="LLM routing"
                  lines={routing.attempts.map(
                    (attempt) =>
                      `${attempt.runtime} / ${attempt.model} | ${attempt.status}${attempt.reason ? ` | ${attempt.reason}` : ''}`
                  )}
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

function AuditMetricBlock({
  title,
  lines,
}: {
  title: string;
  lines: string[];
}) {
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
