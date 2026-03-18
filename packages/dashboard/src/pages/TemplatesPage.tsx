import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Layers3, Sparkles } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';

type TemplatePresetSummary = {
  id: string;
  name: string;
  description: string;
  recommended_for: string;
  summary: {
    goals: number;
    agents: number;
    tools: number;
    policies: number;
  };
};

type TemplatePresetDetail = {
  id: string;
  name: string;
  description: string;
  recommended_for: string;
  template: {
    company: {
      name: string;
      mission?: string | null;
    };
    goals: Array<{ title: string }>;
    agents: Array<{ name: string; title?: string | null; role: string }>;
    tools: Array<{ name: string; type: string }>;
    policies: Array<{ name: string; type: string }>;
  };
};

type TemplatePresetDryRun = {
  preserve_company_identity: boolean;
  company: {
    current_name: string;
    current_mission: string | null;
    incoming_name: string;
    incoming_mission: string | null;
    resulting_name: string;
    resulting_mission: string | null;
  };
  current: {
    goals: number;
    agents: number;
    tools: number;
    policies: number;
    budgets: number;
  };
  incoming: {
    goals: number;
    agents: number;
    tools: number;
    policies: number;
    budgets: number;
  };
  changes: {
    goals_to_add: number;
    agents_to_add: number;
    policies_to_add: number;
    budgets_to_add: number;
    tools_to_create: number;
    tools_to_update: number;
    total_new_records: number;
  };
  collisions: {
    agent_names: string[];
    goal_titles: string[];
    policy_names: string[];
    tool_names: string[];
  };
  record_changes: {
    goals_to_add: string[];
    agents_to_add: string[];
    policies_to_add: string[];
    tools_to_create: string[];
    tools_to_update: string[];
    budgets_to_add: Array<{
      agent_name: string;
      limit_usd: number;
      spent_usd: number;
    }>;
  };
  projected: {
    goals: {
      count: number;
      names: string[];
    };
    agents: {
      count: number;
      names: string[];
    };
    tools: {
      count: number;
      names: string[];
    };
    policies: {
      count: number;
      names: string[];
    };
    budgets: {
      count: number;
      agent_names: string[];
    };
  };
  warnings: string[];
};

export default function TemplatesPage() {
  const { request, loading, error } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [presets, setPresets] = useState<TemplatePresetSummary[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [presetDetail, setPresetDetail] = useState<TemplatePresetDetail | null>(null);
  const [dryRun, setDryRun] = useState<TemplatePresetDryRun | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [savingPreview, setSavingPreview] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    const fetchPresets = async () => {
      const data = await request('/templates/presets');
      setPresets(data);
      if (!selectedPresetId && data[0]?.id) {
        setSelectedPresetId(data[0].id);
      }
    };

    void fetchPresets();
  }, [request]);

  useEffect(() => {
    const fetchPresetContext = async () => {
      if (!selectedPresetId) {
        setPresetDetail(null);
        setDryRun(null);
        return;
      }

      setDryRunLoading(true);
      setSuccessMessage(null);
      setConfirmationText('');

      try {
        const requests: [Promise<TemplatePresetDetail>, Promise<{ preview: TemplatePresetDryRun }> | null] = [
          request(`/templates/presets/${selectedPresetId}`) as Promise<TemplatePresetDetail>,
          selectedCompanyId
            ? (request(`/templates/presets/${selectedPresetId}/dry-run`) as Promise<{ preview: TemplatePresetDryRun }>)
            : null,
        ];
        const [detail, dryRunResponse] = await Promise.all(requests);
        setPresetDetail(detail);
        setDryRun(dryRunResponse?.preview ?? null);
      } finally {
        setDryRunLoading(false);
      }
    };

    void fetchPresetContext();
  }, [request, selectedCompanyId, selectedPresetId]);

  const canImport = confirmationText.trim().toUpperCase() === 'IMPORT' && Boolean(dryRun) && !dryRunLoading;
  const collisionCount = dryRun
    ? dryRun.collisions.agent_names.length +
      dryRun.collisions.goal_titles.length +
      dryRun.collisions.policy_names.length +
      dryRun.collisions.tool_names.length
    : 0;

  const handleImport = async () => {
    if (!selectedCompanyId || !selectedPresetId || !canImport) {
      return;
    }

    setImporting(true);
    setSuccessMessage(null);
    try {
      const data = await request(`/templates/import-preset/${selectedPresetId}`, {
        method: 'POST',
      });
      const dryRunResponse = await request(`/templates/presets/${selectedPresetId}/dry-run`);
      setDryRun(dryRunResponse.preview);
      setSuccessMessage(`Imported preset "${data.preset.name}" into ${selectedCompany?.name ?? 'the selected company'}.`);
      setConfirmationText('');
    } finally {
      setImporting(false);
    }
  };

  const handleSavePreview = async () => {
    if (!selectedPresetId || !dryRun) {
      return;
    }

    setSavingPreview(true);
    setSuccessMessage(null);
    try {
      const data = await request(`/templates/presets/${selectedPresetId}/save-preview`, {
        method: 'POST',
      });
      setDryRun(data.preview);
      setSuccessMessage(`Saved preview snapshot for "${data.preset.name}" to the audit log.`);
    } finally {
      setSavingPreview(false);
    }
  };

  if (!selectedCompany) {
    return <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">Choose a company to explore templates.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Templates</h2>
          <p className="text-sm text-muted-foreground">Reusable company presets for {selectedCompany.name}</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Preset imports keep your current company name and mission.
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {successMessage && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div>}

      <div className="grid gap-4 xl:grid-cols-[1.05fr_1.45fr]">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <div className="mb-4">
            <h3 className="text-lg font-semibold">Preset Library</h3>
            <p className="text-sm text-muted-foreground">Start with local, curated presets before moving to a remote marketplace.</p>
          </div>

          <div className="space-y-3">
            {presets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => setSelectedPresetId(preset.id)}
                className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                  preset.id === selectedPresetId ? 'border-primary bg-primary/5' : 'hover:bg-accent'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-foreground">{preset.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{preset.description}</div>
                  </div>
                  {preset.id === selectedPresetId && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-2 py-1">{preset.summary.agents} agents</span>
                  <span className="rounded-full bg-muted px-2 py-1">{preset.summary.goals} goals</span>
                  <span className="rounded-full bg-muted px-2 py-1">{preset.summary.tools} tools</span>
                  <span className="rounded-full bg-muted px-2 py-1">{preset.summary.policies} policies</span>
                </div>
              </button>
            ))}

            {presets.length === 0 && !loading && (
              <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                No presets available.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          {presetDetail ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-2xl font-semibold tracking-tight">{presetDetail.name}</h3>
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">Local preset</span>
                </div>
                <p className="text-sm text-muted-foreground">{presetDetail.description}</p>
                <p className="text-sm text-muted-foreground">
                  Recommended for: <span className="font-medium text-foreground">{presetDetail.recommended_for}</span>
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <PreviewBlock
                  title="Goals"
                  items={presetDetail.template.goals.map((goal) => goal.title)}
                  emptyLabel="No goals in preset"
                />
                <PreviewBlock
                  title="Agents"
                  items={presetDetail.template.agents.map((agent) => `${agent.name} - ${agent.title || agent.role}`)}
                  emptyLabel="No agents in preset"
                />
                <PreviewBlock
                  title="Tools"
                  items={presetDetail.template.tools.map((tool) => `${tool.name} - ${tool.type}`)}
                  emptyLabel="No tools in preset"
                />
                <PreviewBlock
                  title="Policies"
                  items={presetDetail.template.policies.map((policy) => `${policy.name} - ${policy.type}`)}
                  emptyLabel="No policies in preset"
                />
              </div>

              <div className="rounded-2xl border bg-muted/20 p-5">
                <div className="flex items-start gap-3">
                  <Layers3 className="mt-0.5 h-5 w-5 text-primary" />
                  <div className="space-y-4">
                    <div>
                      <div className="font-medium text-foreground">Dry run before import</div>
                      <div className="text-sm text-muted-foreground">
                        Review what will be added or updated in {selectedCompany.name} before confirming the preset import.
                      </div>
                    </div>

                    {dryRunLoading && <div className="text-sm text-muted-foreground">Calculating import preview...</div>}

                    {dryRun && (
                      <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-3">
                          <MetricCard
                            title="Current company"
                            lines={[
                              `${dryRun.current.agents} agents`,
                              `${dryRun.current.goals} goals`,
                              `${dryRun.current.tools} tools`,
                              `${dryRun.current.policies} policies`,
                            ]}
                          />
                          <MetricCard
                            title="Incoming preset"
                            lines={[
                              `${dryRun.incoming.agents} agents`,
                              `${dryRun.incoming.goals} goals`,
                              `${dryRun.incoming.tools} tools`,
                              `${dryRun.incoming.policies} policies`,
                            ]}
                          />
                          <MetricCard
                            title="Expected changes"
                            lines={[
                              `${dryRun.changes.total_new_records} new records`,
                              `${dryRun.changes.tools_to_create} tools to create`,
                              `${dryRun.changes.tools_to_update} tools to update`,
                              `${dryRun.changes.budgets_to_add} budgets to add`,
                            ]}
                          />
                        </div>

                        <div className="rounded-2xl border bg-background p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-medium text-foreground">Company identity after import</div>
                              <div className="mt-1 text-sm text-muted-foreground">
                                {dryRun.company.resulting_name}
                                {dryRun.company.resulting_mission ? ` - ${dryRun.company.resulting_mission}` : ''}
                              </div>
                            </div>
                            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
                              {dryRun.preserve_company_identity ? 'Identity preserved' : 'Identity replaced'}
                            </span>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          <CollisionBlock
                            title="Agent name overlaps"
                            items={dryRun.collisions.agent_names}
                            emptyLabel="No overlapping agent names"
                          />
                          <CollisionBlock
                            title="Goal title overlaps"
                            items={dryRun.collisions.goal_titles}
                            emptyLabel="No overlapping goal titles"
                          />
                          <CollisionBlock
                            title="Policy name overlaps"
                            items={dryRun.collisions.policy_names}
                            emptyLabel="No overlapping policy names"
                          />
                          <CollisionBlock
                            title="Tool updates"
                            items={dryRun.collisions.tool_names}
                            emptyLabel="All tools will be created as new records"
                          />
                        </div>

                        <div className="space-y-3">
                          <div className="text-sm font-medium text-foreground">Record diff</div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <ChangeListBlock
                              title="Goals to create"
                              items={dryRun.record_changes.goals_to_add}
                              emptyLabel="No goals will be created"
                            />
                            <ChangeListBlock
                              title="Agents to create"
                              items={dryRun.record_changes.agents_to_add}
                              emptyLabel="No agents will be created"
                            />
                            <ChangeListBlock
                              title="Policies to create"
                              items={dryRun.record_changes.policies_to_add}
                              emptyLabel="No policies will be created"
                            />
                            <ChangeListBlock
                              title="Tools to create"
                              items={dryRun.record_changes.tools_to_create}
                              emptyLabel="No new tools will be created"
                            />
                          </div>
                          <div className="grid gap-3 md:grid-cols-[1fr_1.1fr]">
                            <ChangeListBlock
                              title="Tools to update"
                              items={dryRun.record_changes.tools_to_update}
                              emptyLabel="No existing tools will be updated"
                            />
                            <BudgetChangeBlock items={dryRun.record_changes.budgets_to_add} />
                          </div>
                        </div>

                        <div className="space-y-3">
                          <div className="text-sm font-medium text-foreground">Projected state after import</div>
                          <div className="grid gap-3 md:grid-cols-3">
                            <MetricCard
                              title="Projected company"
                              lines={[
                                `${dryRun.projected.agents.count} agents`,
                                `${dryRun.projected.goals.count} goals`,
                                `${dryRun.projected.tools.count} tools`,
                                `${dryRun.projected.policies.count} policies`,
                              ]}
                            />
                            <MetricCard
                              title="Projected budgets"
                              lines={[
                                `${dryRun.projected.budgets.count} budget rows`,
                                `${dryRun.changes.tools_to_update} tool updates kept in place`,
                                `${dryRun.changes.total_new_records} new rows added`,
                                `${collisionCount} overlap signals detected`,
                              ]}
                            />
                            <MetricCard
                              title="Resulting identity"
                              lines={[
                                dryRun.company.resulting_name,
                                dryRun.company.resulting_mission || 'No resulting mission set',
                              ]}
                            />
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <ProjectedListBlock
                              title={`Projected goals (${dryRun.projected.goals.count})`}
                              items={dryRun.projected.goals.names}
                              emptyLabel="No goals in projected state"
                            />
                            <ProjectedListBlock
                              title={`Projected agents (${dryRun.projected.agents.count})`}
                              items={dryRun.projected.agents.names}
                              emptyLabel="No agents in projected state"
                            />
                            <ProjectedListBlock
                              title={`Projected tools (${dryRun.projected.tools.count})`}
                              items={dryRun.projected.tools.names}
                              emptyLabel="No tools in projected state"
                            />
                            <ProjectedListBlock
                              title={`Projected policies (${dryRun.projected.policies.count})`}
                              items={dryRun.projected.policies.names}
                              emptyLabel="No policies in projected state"
                            />
                          </div>
                          <ProjectedListBlock
                            title={`Projected budgets (${dryRun.projected.budgets.count})`}
                            items={dryRun.projected.budgets.agent_names}
                            emptyLabel="No budget rows in projected state"
                          />
                        </div>

                        <div className="rounded-2xl border bg-amber-50/70 p-4">
                          <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                            <AlertTriangle className="h-4 w-4" />
                            Import warnings
                          </div>
                          <div className="mt-3 space-y-2 text-sm text-amber-900">
                            {dryRun.warnings.map((warning) => (
                              <div key={warning} className="rounded-xl bg-white/70 px-3 py-2">
                                {warning}
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 text-xs text-amber-800">
                            {collisionCount > 0
                              ? `${collisionCount} overlap signal(s) were found in the selected company.`
                              : 'No direct naming conflicts were found in the selected company.'}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                      <input
                        value={confirmationText}
                        onChange={(event) => setConfirmationText(event.target.value)}
                        placeholder="Type IMPORT to confirm"
                        className="rounded-md border bg-background px-3 py-2 text-sm"
                      />
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => void handleSavePreview()}
                          disabled={!dryRun || dryRunLoading || savingPreview}
                          className="rounded-md border bg-background px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingPreview ? 'Saving...' : 'Save Preview Snapshot'}
                        </button>
                        <button
                          onClick={() => void handleImport()}
                          disabled={!canImport || importing}
                          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {importing ? 'Importing...' : `Import Into ${selectedCompany.name}`}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              Select a preset to inspect its structure.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewBlock({ title, items, emptyLabel }: { title: string; items: string[]; emptyLabel: string }) {
  return (
    <div className="rounded-2xl border bg-muted/20 p-4">
      <div className="mb-3 text-sm font-medium text-foreground">{title}</div>
      <div className="space-y-2">
        {items.slice(0, 6).map((item) => (
          <div key={item} className="rounded-xl bg-background px-3 py-2 text-sm text-muted-foreground">
            {item}
          </div>
        ))}
        {items.length === 0 && <div className="text-sm text-muted-foreground">{emptyLabel}</div>}
        {items.length > 6 && <div className="text-xs text-muted-foreground">+{items.length - 6} more</div>}
      </div>
    </div>
  );
}

function MetricCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
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

function CollisionBlock({ title, items, emptyLabel }: { title: string; items: string[]; emptyLabel: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.length === 0 && <div className="text-sm text-muted-foreground">{emptyLabel}</div>}
        {items.map((item) => (
          <span key={item} className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function ChangeListBlock({ title, items, emptyLabel }: { title: string; items: string[]; emptyLabel: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-3 space-y-2">
        {items.length === 0 && <div className="text-sm text-muted-foreground">{emptyLabel}</div>}
        {items.slice(0, 6).map((item) => (
          <div key={item} className="rounded-xl bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            {item}
          </div>
        ))}
        {items.length > 6 && <div className="text-xs text-muted-foreground">+{items.length - 6} more</div>}
      </div>
    </div>
  );
}

function BudgetChangeBlock({
  items,
}: {
  items: Array<{ agent_name: string; limit_usd: number; spent_usd: number }>;
}) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="text-sm font-medium text-foreground">Budgets to add</div>
      <div className="mt-3 space-y-2">
        {items.length === 0 && <div className="text-sm text-muted-foreground">No budgets will be created</div>}
        {items.slice(0, 6).map((item) => (
          <div key={`${item.agent_name}-${item.limit_usd}`} className="rounded-xl bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            {item.agent_name} - limit ${item.limit_usd.toFixed(2)}, starting spend ${item.spent_usd.toFixed(2)}
          </div>
        ))}
        {items.length > 6 && <div className="text-xs text-muted-foreground">+{items.length - 6} more</div>}
      </div>
    </div>
  );
}

function ProjectedListBlock({ title, items, emptyLabel }: { title: string; items: string[]; emptyLabel: string }) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mt-3 space-y-2">
        {items.length === 0 && <div className="text-sm text-muted-foreground">{emptyLabel}</div>}
        {items.slice(0, 8).map((item, index) => (
          <div key={`${item}-${index}`} className="rounded-xl bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            {item}
          </div>
        ))}
        {items.length > 8 && <div className="text-xs text-muted-foreground">+{items.length - 8} more</div>}
      </div>
    </div>
  );
}
