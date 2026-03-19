import { useEffect, useMemo, useState } from 'react';
import type {
  TemplateAISuggestResponse,
  TemplateAISuggestion,
  CompanyTemplate,
  TemplateImportDryRun,
  TemplateMarketplaceListResponse,
  TemplateSource,
} from '@biuro/shared';
import { AlertTriangle, CheckCircle2, Globe2, Layers3, Sparkles, Store } from 'lucide-react';
import { clsx } from 'clsx';
import { useApi } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';

type Summary = {
  id: string;
  name: string;
  description: string;
  recommended_for: string;
  summary: { goals: number; agents: number; tools: number; policies: number };
  source: TemplateSource;
  vendor?: string;
  categories?: string[];
  badge?: string | null;
  source_url?: string | null;
};

type Detail = {
  id: string;
  name: string;
  description: string;
  recommended_for: string;
  source: TemplateSource;
  vendor?: string;
  categories?: string[];
  badge?: string | null;
  source_url?: string | null;
  template: CompanyTemplate;
};
type DryRun = TemplateImportDryRun;
type MarketplaceResponse = TemplateMarketplaceListResponse;
type AISuggestResponse = TemplateAISuggestResponse;
type AIDraft = TemplateAISuggestion;
type AgentOption = {
  id: string;
  name: string;
  role: string;
  title?: string | null;
  status?: string | null;
};

function endpoints(source: TemplateSource, id: string) {
  return source === 'marketplace'
    ? {
        detail: `/templates/marketplace/${id}`,
        dryRun: `/templates/marketplace/${id}/dry-run`,
        savePreview: `/templates/marketplace/${id}/save-preview`,
        install: `/templates/import-marketplace/${id}`,
      }
    : {
        detail: `/templates/presets/${id}`,
        dryRun: `/templates/presets/${id}/dry-run`,
        savePreview: `/templates/presets/${id}/save-preview`,
        install: `/templates/import-preset/${id}`,
      };
}

function label(source: TemplateSource) {
  return source === 'marketplace' ? 'Marketplace' : 'Local preset';
}

export default function TemplatesPage() {
  const { request, loading, error } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [source, setSource] = useState<TemplateSource>('marketplace');
  const [localItems, setLocalItems] = useState<Summary[]>([]);
  const [marketItems, setMarketItems] = useState<Summary[]>([]);
  const [catalog, setCatalog] = useState<MarketplaceResponse['catalog'] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingPreview, setSavingPreview] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiDraft, setAiDraft] = useState<AIDraft | null>(null);
  const [aiPlanner, setAiPlanner] = useState<AISuggestResponse['planner'] | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);

  const activeItems = source === 'marketplace' ? marketItems : localItems;
  const activeSummary = useMemo(() => activeItems.find((item) => item.id === selectedId) ?? null, [activeItems, selectedId]);

  useEffect(() => {
    const load = async () => {
      const [local, marketplace, agents] = await Promise.all([
        request('/templates/presets') as Promise<Array<Omit<Summary, 'source'>>>,
        request('/templates/marketplace') as Promise<MarketplaceResponse>,
        selectedCompanyId
          ? (request(`/agents?company_id=${selectedCompanyId}`, undefined, { suppressError: true }) as Promise<AgentOption[]>)
          : Promise.resolve([] as AgentOption[]),
      ]);
      const normalizedLocal = local.map((item) => ({ ...item, source: 'local' as const }));
      const normalizedMarket = marketplace.templates.map((item) => ({ ...item, source: 'marketplace' as const }));
      setLocalItems(normalizedLocal);
      setMarketItems(normalizedMarket);
      setCatalog(marketplace.catalog);
      setAgentOptions(agents);
      if (!selectedId) {
        const first = normalizedMarket[0] ?? normalizedLocal[0];
        if (first) {
          setSource(first.source);
          setSelectedId(first.id);
        }
      }
    };
    void load();
  }, [request, selectedCompanyId]);

  useEffect(() => {
    if (!selectedId || activeItems.length === 0) {
      return;
    }
    const load = async () => {
      setConfirmationText('');
      setSuccessMessage(null);
      const ep = endpoints(source, selectedId);
      const [nextDetail, preview] = await Promise.all([
        request(ep.detail) as Promise<Omit<Detail, 'source'>>,
        selectedCompanyId ? (request(ep.dryRun) as Promise<{ preview: DryRun }>) : Promise.resolve(null),
      ]);
      setDetail({ ...nextDetail, source });
      setDryRun(preview?.preview ?? null);
    };
    void load();
  }, [request, selectedCompanyId, source, selectedId, activeItems.length]);

  if (!selectedCompany) {
    return <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">Choose a company to explore templates.</div>;
  }

  const canInstall = confirmationText.trim().toUpperCase() === 'IMPORT' && Boolean(dryRun);

  const install = async () => {
    if (!selectedId || !canInstall) return;
    setBusy(true);
    try {
      const ep = endpoints(source, selectedId);
      const result = await request(ep.install, { method: 'POST' });
      const refreshed = await request(ep.dryRun);
      setDryRun(refreshed.preview);
      setConfirmationText('');
      setSuccessMessage(`Installed "${result.template?.name ?? result.preset?.name}" into ${selectedCompany.name}.`);
    } finally {
      setBusy(false);
    }
  };

  const savePreview = async () => {
    if (!selectedId || !dryRun) return;
    setSavingPreview(true);
    try {
      const ep = endpoints(source, selectedId);
      const result = await request(ep.savePreview, { method: 'POST' });
      setDryRun(result.preview);
      setSuccessMessage(`Saved preview snapshot for "${result.template?.name ?? result.preset?.name}".`);
    } finally {
      setSavingPreview(false);
    }
  };

  const suggestWithAI = async () => {
    if (!aiPrompt.trim()) {
      return;
    }
    setAiBusy(true);
    try {
      const result = await request('/templates/ai-suggest', {
        method: 'POST',
        body: JSON.stringify({
          prompt: aiPrompt.trim(),
        }),
      }) as AISuggestResponse;
      setAiDraft(result.suggestion);
      setAiPlanner(result.planner);
      setSuccessMessage(null);
    } finally {
      setAiBusy(false);
    }
  };

  const createTaskFromDraft = async () => {
    if (!selectedCompanyId || !aiDraft) {
      return;
    }
    setCreatingTask(true);
    try {
      await request('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          company_id: selectedCompanyId,
          title: aiDraft.title,
          description: aiDraft.description,
          assigned_to: aiDraft.suggested_agent_id || undefined,
          priority: Number(aiDraft.priority) || 0,
        }),
      });
      setSuccessMessage(`Created task "${aiDraft.title}" from AI draft.`);
      setAiPrompt('');
    } finally {
      setCreatingTask(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Templates</h2>
          <p className="text-sm text-muted-foreground">Local presets plus an installable marketplace for {selectedCompany.name}</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Every install goes through the same dry-run and audit path.
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {successMessage && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div>}

      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">AI Pre-fill</h3>
            <p className="text-sm text-muted-foreground">
              Describe a task in natural language and get an editable draft with suggested owner and priority.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border bg-amber-50 px-3 py-1 text-xs text-amber-700">
            <Sparkles className="h-3.5 w-3.5" />
            Smart Templates MVP
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-4">
            <label className="block text-sm font-medium text-foreground" htmlFor="ai-template-prompt">
              Describe the work in plain language
            </label>
            <textarea
              id="ai-template-prompt"
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              placeholder='Example: sprawdz czy konkurencja obniżyła ceny i przygotuj krótkie podsumowanie dla zespołu'
              className="min-h-[148px] w-full rounded-2xl border bg-background px-4 py-3 text-sm leading-7 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void suggestWithAI()}
                disabled={aiBusy || aiPrompt.trim().length === 0}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {aiBusy ? 'Generating...' : 'Generate AI Draft'}
              </button>
              <div className="text-xs text-muted-foreground">
                Uses company runtime routing first, then falls back to a deterministic draft if needed.
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-muted/20 p-5">
            {aiDraft ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium text-foreground">AI-generated draft</div>
                  {aiPlanner && (
                    <span className="rounded-full border bg-background px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {aiPlanner.mode === 'llm'
                        ? `Planned by ${aiPlanner.runtime || 'LLM'}`
                        : 'Fallback draft'}
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">Title</label>
                    <input
                      value={aiDraft.title}
                      onChange={(event) => setAiDraft((current) => (current ? { ...current, title: event.target.value } : current))}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">Description</label>
                    <textarea
                      value={aiDraft.description}
                      onChange={(event) => setAiDraft((current) => (current ? { ...current, description: event.target.value } : current))}
                      className="min-h-[132px] w-full rounded-md border bg-background px-3 py-2 text-sm leading-7"
                    />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">Priority</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={aiDraft.priority}
                        onChange={(event) =>
                          setAiDraft((current) =>
                            current
                              ? { ...current, priority: Math.max(0, Math.min(100, Number(event.target.value) || 0)) }
                              : current
                          )
                        }
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">Suggested owner</label>
                      <select
                        value={aiDraft.suggested_agent_id || ''}
                        onChange={(event) => {
                          const nextId = event.target.value || null;
                          const nextAgent = agentOptions.find((agent) => agent.id === nextId) ?? null;
                          setAiDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  suggested_agent_id: nextId,
                                  suggested_agent_name: nextAgent?.name ?? null,
                                  default_role: nextAgent?.role ?? current.default_role,
                                }
                              : current
                          );
                        }}
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      >
                        <option value="">No assignee</option>
                        {agentOptions.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name} - {agent.title || agent.role}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Chip>Confidence: {aiDraft.confidence}</Chip>
                  <Chip>Role: {aiDraft.default_role || 'Unassigned'}</Chip>
                  {aiDraft.suggested_agent_name ? <Chip>Agent: {aiDraft.suggested_agent_name}</Chip> : null}
                </div>

                {aiDraft.warnings.length > 0 && (
                  <div className="rounded-2xl border bg-amber-50/70 p-4">
                    <div className="text-sm font-medium text-amber-900">Draft warnings</div>
                    <div className="mt-2 space-y-2">
                      {aiDraft.warnings.map((warning) => (
                        <div key={warning} className="text-sm text-amber-900">
                          {warning}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void createTaskFromDraft()}
                    disabled={creatingTask || aiDraft.title.trim().length === 0}
                    className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {creatingTask ? 'Creating...' : 'Create Task From Draft'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAiDraft(null);
                      setAiPlanner(null);
                    }}
                    className="rounded-md border bg-background px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent"
                  >
                    Clear Draft
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                No AI draft yet. Describe the work on the left to generate a pre-filled task draft.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.05fr_1.45fr]">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-4">
            <h3 className="text-lg font-semibold">Library</h3>
            <p className="text-sm text-muted-foreground">Switch between local presets and the external marketplace catalog.</p>
          </div>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <SourceCard icon={Store} active={source === 'marketplace'} title="Marketplace" body="External catalog + bundled fallback." onClick={() => { setSource('marketplace'); setSelectedId(marketItems[0]?.id ?? null); }} />
            <SourceCard icon={Layers3} active={source === 'local'} title="Local Library" body="Curated templates bundled with Biuro." onClick={() => { setSource('local'); setSelectedId(localItems[0]?.id ?? null); }} />
          </div>
          {source === 'marketplace' && catalog && (
            <div className="mb-4 rounded-2xl border bg-muted/20 p-4 text-sm">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Globe2 className="h-4 w-4 text-primary" />
                {catalog.name}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Source: {catalog.source_type === 'remote' ? 'External manifest' : 'Bundled fallback catalog'}
              </div>
              {catalog.source_url && <div className="mt-1 break-all text-xs text-muted-foreground">{catalog.source_url}</div>}
            </div>
          )}
          <div className="space-y-3">
            {activeItems.map((item) => (
              <button
                key={`${item.source}-${item.id}`}
                onClick={() => setSelectedId(item.id)}
                className={clsx('w-full rounded-2xl border p-4 text-left transition-colors', item.id === selectedId ? 'border-primary bg-primary/5' : 'hover:bg-accent')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold text-foreground">{item.name}</div>
                      <span className={clsx('rounded-full px-2 py-1 text-[11px] font-medium', item.source === 'marketplace' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700')}>{label(item.source)}</span>
                      {item.badge && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">{item.badge}</span>}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{item.description}</div>
                    {item.vendor && <div className="mt-1 text-xs text-muted-foreground">By {item.vendor}</div>}
                  </div>
                  {item.id === selectedId && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Chip>{item.summary.agents} agents</Chip>
                  <Chip>{item.summary.goals} goals</Chip>
                  <Chip>{item.summary.tools} tools</Chip>
                  <Chip>{item.summary.policies} policies</Chip>
                  {item.categories?.slice(0, 2).map((category) => <Chip key={category}>{category}</Chip>)}
                </div>
              </button>
            ))}
            {activeItems.length === 0 && !loading && <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">No templates available in this library.</div>}
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          {detail && activeSummary ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-2xl font-semibold tracking-tight">{detail.name}</h3>
                  <span className={clsx('rounded-full px-3 py-1 text-xs', detail.source === 'marketplace' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700')}>{label(detail.source)}</span>
                  {detail.badge && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700">{detail.badge}</span>}
                </div>
                <p className="text-sm text-muted-foreground">{detail.description}</p>
                <p className="text-sm text-muted-foreground">Recommended for: <span className="font-medium text-foreground">{detail.recommended_for}</span></p>
                {detail.vendor && <p className="text-sm text-muted-foreground">Published by: <span className="font-medium text-foreground">{detail.vendor}</span></p>}
                {detail.source_url && <div className="break-all text-xs text-muted-foreground">{detail.source_url}</div>}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Block title="Goals" items={detail.template.goals.map((goal) => goal.title)} />
                <Block title="Agents" items={detail.template.agents.map((agent) => `${agent.name} - ${agent.title || agent.role}`)} />
                <Block title="Tools" items={detail.template.tools.map((tool) => `${tool.name} - ${tool.type}`)} />
                <Block title="Policies" items={detail.template.policies.map((policy) => `${policy.name} - ${policy.type}`)} />
              </div>

              {dryRun && (
                <div className="rounded-2xl border bg-muted/20 p-5">
                  <div className="flex items-start gap-3">
                    <Layers3 className="mt-0.5 h-5 w-5 text-primary" />
                    <div className="space-y-4">
                      <div>
                        <div className="font-medium text-foreground">Dry run before install</div>
                        <div className="text-sm text-muted-foreground">Review what will be added or updated in {selectedCompany.name} before installing this template.</div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <Metric title="Current" lines={[`${dryRun.current.agents} agents`, `${dryRun.current.goals} goals`, `${dryRun.current.tools} tools`, `${dryRun.current.policies} policies`]} />
                        <Metric title="Incoming" lines={[`${dryRun.incoming.agents} agents`, `${dryRun.incoming.goals} goals`, `${dryRun.incoming.tools} tools`, `${dryRun.incoming.policies} policies`]} />
                        <Metric title="Changes" lines={[`${dryRun.changes.total_new_records} new records`, `${dryRun.changes.tools_to_create} tools to create`, `${dryRun.changes.tools_to_update} tools to update`, `${dryRun.changes.budgets_to_add} budgets to add`]} />
                      </div>
                      <div className="rounded-2xl border bg-background p-4 text-sm text-muted-foreground">
                        {dryRun.company.resulting_name}{dryRun.company.resulting_mission ? ` - ${dryRun.company.resulting_mission}` : ''} · {dryRun.preserve_company_identity ? 'Identity preserved' : 'Identity replaced'}
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <SimpleList title="Goals to create" items={dryRun.record_changes.goals_to_add} empty="No goals will be created" />
                        <SimpleList title="Agents to create" items={dryRun.record_changes.agents_to_add} empty="No agents will be created" />
                        <SimpleList title="Policies to create" items={dryRun.record_changes.policies_to_add} empty="No policies will be created" />
                        <SimpleList title="Tools to create" items={dryRun.record_changes.tools_to_create} empty="No new tools will be created" />
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <SimpleList title="Tool updates" items={dryRun.record_changes.tools_to_update} empty="No existing tools will be updated" />
                        <SimpleList title="Warnings" items={dryRun.warnings} empty="No import warnings" tone="warning" />
                      </div>
                      {(dryRun.collisions.agent_names.length + dryRun.collisions.goal_titles.length + dryRun.collisions.policy_names.length + dryRun.collisions.tool_names.length) > 0 && (
                        <div className="rounded-2xl border bg-amber-50/70 p-4 text-sm text-amber-900">
                          <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Overlap signals detected</div>
                          <div className="mt-2 text-xs">
                            Agents: {dryRun.collisions.agent_names.length}, goals: {dryRun.collisions.goal_titles.length}, policies: {dryRun.collisions.policy_names.length}, tools: {dryRun.collisions.tool_names.length}
                          </div>
                        </div>
                      )}
                      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                        <input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} placeholder="Type IMPORT to confirm" className="rounded-md border bg-background px-3 py-2 text-sm" />
                        <div className="flex flex-wrap gap-3">
                          <button onClick={() => void savePreview()} disabled={savingPreview} className="rounded-md border bg-background px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50">
                            {savingPreview ? 'Saving...' : 'Save Preview Snapshot'}
                          </button>
                          <button onClick={() => void install()} disabled={!canInstall || busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                            {busy ? 'Installing...' : `Install Into ${selectedCompany.name}`}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">Select a template to inspect its structure.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceCard({ icon: Icon, active, title, body, onClick }: { icon: typeof Store; active: boolean; title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={clsx('rounded-2xl border p-4 text-left transition-colors', active ? 'border-primary bg-primary/5' : 'hover:bg-accent')}>
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><Icon className="h-4 w-4" />{title}</div>
      <div className="mt-2 text-xs text-muted-foreground">{body}</div>
    </button>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-muted px-2 py-1">{children}</span>;
}

function Block({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border bg-muted/20 p-4">
      <div className="mb-3 text-sm font-medium text-foreground">{title}</div>
      <div className="space-y-2">
        {items.slice(0, 6).map((item) => <div key={item} className="rounded-xl bg-background px-3 py-2 text-sm text-muted-foreground">{item}</div>)}
        {items.length === 0 && <div className="text-sm text-muted-foreground">No items</div>}
      </div>
    </div>
  );
}

function Metric({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-3 space-y-2">{lines.map((line) => <div key={line} className="text-sm text-muted-foreground">{line}</div>)}</div>
    </div>
  );
}

function SimpleList({ title, items, empty, tone = 'default' }: { title: string; items: string[]; empty: string; tone?: 'default' | 'warning' }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-3 space-y-2">
        {items.length === 0 && <div className="text-sm text-muted-foreground">{empty}</div>}
        {items.slice(0, 6).map((item) => (
          <div key={item} className={clsx('rounded-xl px-3 py-2 text-sm', tone === 'warning' ? 'bg-amber-50 text-amber-900' : 'bg-muted/40 text-muted-foreground')}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
