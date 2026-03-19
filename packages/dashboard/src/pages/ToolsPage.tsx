import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Globe, Hammer, Package2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';

type ToolCall = {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  task_title: string | null;
  agent_name: string | null;
  status: 'success' | 'error';
  duration_ms: number | null;
  created_at: string;
};

type AssignedAgent = {
  agent_id: string;
  agent_name: string;
};

type Tool = {
  id: string;
  name: string;
  description?: string | null;
  type: 'builtin' | 'http' | 'bash' | 'mcp';
  config?: Record<string, unknown> | null;
  agent_count: number;
  assigned_agents: AssignedAgent[];
  usage: {
    total_calls: number;
    success_count: number;
    error_count: number;
    last_called_at: string | null;
    last_status: 'success' | 'error' | null;
  };
  recent_calls: ToolCall[];
};

type CompanyAgent = {
  id: string;
  name: string;
  role?: string | null;
  status?: string | null;
};

type ToolCallHistoryItem = ToolCall & {
  input: unknown;
  output: unknown;
};

type ToolCallHistoryResponse = {
  tool: {
    id: string;
    company_id: string;
    name: string;
    description?: string | null;
    type: 'builtin' | 'http' | 'bash' | 'mcp';
    created_at: string;
  };
  filters: {
    status: 'success' | 'error' | null;
    agent_id: string | null;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    has_more: boolean;
  };
  summary: {
    total_calls: number;
    success_count: number;
    error_count: number;
    last_called_at: string | null;
  };
  items: ToolCallHistoryItem[];
};

type ToolDraft = {
  name: string;
  description: string;
  type: 'builtin' | 'http' | 'bash' | 'mcp';
  configText: string;
};

type ToolTestResult = {
  ok: boolean;
  duration_ms: number;
  output?: unknown;
  error?: string | null;
  status?: number | null;
};

const typeIcon = {
  builtin: Bot,
  http: Globe,
  bash: Hammer,
  mcp: Package2,
} as const;

const typeFilters = ['all', 'builtin', 'http', 'bash', 'mcp'] as const;
const statusFilters = ['all', 'success', 'error', 'unused'] as const;
const detailStatusFilters = ['all', 'success', 'error'] as const;
const TOOL_CALLS_PAGE_SIZE = 10;

const defaultCreateDraft: ToolDraft = {
  name: '',
  description: '',
  type: 'builtin',
  configText: JSON.stringify({ builtin: 'web_search' }, null, 2),
};

function formatPayloadPreview(payload: unknown) {
  if (payload === null || payload === undefined) return 'None';
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  if (!serialized) return 'None';
  return serialized.length > 240 ? `${serialized.slice(0, 240)}...` : serialized;
}

function formatJson(value: unknown) {
  return JSON.stringify(value ?? null, null, 2);
}

function parseJsonInput(value: string, label: string) {
  try {
    const trimmed = value.trim();
    return trimmed ? JSON.parse(trimmed) : {};
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

export default function ToolsPage() {
  const { request, loading, error } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [tools, setTools] = useState<Tool[]>([]);
  const [agents, setAgents] = useState<CompanyAgent[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<(typeof typeFilters)[number]>('all');
  const [statusFilter, setStatusFilter] = useState<(typeof statusFilters)[number]>('all');
  const [detailStatusFilter, setDetailStatusFilter] = useState<(typeof detailStatusFilters)[number]>('all');
  const [detailAgentFilter, setDetailAgentFilter] = useState('all');
  const [detailPage, setDetailPage] = useState(1);
  const [toolCallHistory, setToolCallHistory] = useState<ToolCallHistoryResponse | null>(null);
  const [toolCallHistoryLoading, setToolCallHistoryLoading] = useState(false);
  const [toolCallHistoryError, setToolCallHistoryError] = useState<string | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<ToolDraft>(defaultCreateDraft);
  const [editDraft, setEditDraft] = useState<ToolDraft>(defaultCreateDraft);
  const [testInputText, setTestInputText] = useState('{}');
  const [testResult, setTestResult] = useState<ToolTestResult | null>(null);
  const [assignAgentId, setAssignAgentId] = useState('none');
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingTool, setTestingTool] = useState(false);
  const [seedingDefaults, setSeedingDefaults] = useState(false);

  const selectedToolId = searchParams.get('tool');

  const reloadTools = useCallback(async () => {
    if (!selectedCompanyId) {
      setTools([]);
      return;
    }
    const data = (await request(`/companies/${selectedCompanyId}/tools`)) as Tool[];
    setTools(data);
  }, [request, selectedCompanyId]);

  const reloadAgents = useCallback(async () => {
    if (!selectedCompanyId) {
      setAgents([]);
      return;
    }
    const data = (await request(`/companies/${selectedCompanyId}/agents`)) as CompanyAgent[];
    setAgents(data);
  }, [request, selectedCompanyId]);

  useEffect(() => {
    const load = async () => {
      await Promise.all([reloadTools(), reloadAgents()]);
    };
    void load();
  }, [reloadAgents, reloadTools]);

  useEffect(() => {
    setDetailStatusFilter('all');
    setDetailAgentFilter('all');
    setDetailPage(1);
    setSelectedCallId(null);
    setTestInputText('{}');
    setTestResult(null);
    setAssignAgentId('none');
    setMutationError(null);
    setMutationMessage(null);
  }, [selectedToolId]);

  const selectedTool = useMemo(() => tools.find((tool) => tool.id === selectedToolId) ?? null, [selectedToolId, tools]);

  useEffect(() => {
    if (!selectedTool) {
      setEditDraft(defaultCreateDraft);
      return;
    }

    setEditDraft({
      name: selectedTool.name,
      description: selectedTool.description || '',
      type: selectedTool.type,
      configText: formatJson(selectedTool.config ?? {}),
    });
  }, [selectedTool]);

  useEffect(() => {
    const fetchToolCallHistory = async () => {
      if (!selectedCompanyId || !selectedToolId) {
        setToolCallHistory(null);
        setToolCallHistoryError(null);
        return;
      }

      const params = new URLSearchParams({ page: String(detailPage), limit: String(TOOL_CALLS_PAGE_SIZE) });
      if (detailStatusFilter !== 'all') params.set('status', detailStatusFilter);
      if (detailAgentFilter !== 'all') params.set('agent_id', detailAgentFilter);

      setToolCallHistoryLoading(true);
      setToolCallHistoryError(null);
      try {
        const data = (await request(
          `/companies/${selectedCompanyId}/tools/${selectedToolId}/calls?${params.toString()}`,
          undefined,
          { suppressError: true }
        )) as ToolCallHistoryResponse;
        setToolCallHistory(data);
      } catch (err: any) {
        setToolCallHistory(null);
        setToolCallHistoryError(err.message || 'Failed to load tool call history.');
      } finally {
        setToolCallHistoryLoading(false);
      }
    };

    void fetchToolCallHistory();
  }, [detailAgentFilter, detailPage, detailStatusFilter, request, selectedCompanyId, selectedToolId]);

  const filteredTools = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return tools.filter((tool) => {
      if (typeFilter !== 'all' && tool.type !== typeFilter) return false;
      if (statusFilter === 'success' && tool.usage.last_status !== 'success') return false;
      if (statusFilter === 'error' && tool.usage.last_status !== 'error') return false;
      if (statusFilter === 'unused' && tool.usage.total_calls > 0) return false;
      if (!normalizedQuery) return true;

      const haystack = [
        tool.name,
        tool.description || '',
        tool.type,
        ...tool.assigned_agents.map((assignment) => assignment.agent_name),
        ...tool.recent_calls.map((call) => `${call.task_title || ''} ${call.agent_name || ''} ${call.status}`),
      ].join(' ').toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [searchQuery, statusFilter, tools, typeFilter]);

  const detailAgentOptions = useMemo(() => {
    if (!selectedTool) return [];
    const options = new Map<string, string>();
    for (const call of [...selectedTool.recent_calls, ...(toolCallHistory?.items ?? [])]) {
      if (call.agent_id && call.agent_name) options.set(call.agent_id, call.agent_name);
    }
    return Array.from(options.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedTool, toolCallHistory?.items]);

  const selectedToolAgentBreakdown = useMemo(() => {
    if (!selectedTool) return [];
    const sourceCalls = toolCallHistory?.items.length ? toolCallHistory.items : selectedTool.recent_calls;
    const summary = new Map<string, { agent_name: string; total_calls: number; success_count: number; error_count: number }>();

    for (const call of sourceCalls) {
      const key = call.agent_id || call.agent_name || 'unknown';
      const current = summary.get(key) ?? { agent_name: call.agent_name || 'Unknown agent', total_calls: 0, success_count: 0, error_count: 0 };
      current.total_calls += 1;
      if (call.status === 'success') current.success_count += 1;
      else current.error_count += 1;
      summary.set(key, current);
    }

    return Array.from(summary.values()).sort((a, b) => b.total_calls - a.total_calls);
  }, [selectedTool, toolCallHistory?.items]);

  const selectedHistoryCall = useMemo(() => {
    if (!toolCallHistory?.items.length) return null;
    if (selectedCallId) return toolCallHistory.items.find((call) => call.id === selectedCallId) ?? toolCallHistory.items[0];
    return toolCallHistory.items[0];
  }, [selectedCallId, toolCallHistory?.items]);

  useEffect(() => {
    if (!toolCallHistory?.items.length) {
      setSelectedCallId(null);
      return;
    }
    setSelectedCallId((current) => {
      if (current && toolCallHistory.items.some((call) => call.id === current)) return current;
      return toolCallHistory.items[0]?.id ?? null;
    });
  }, [toolCallHistory?.items]);

  const availableAgentsForAssignment = useMemo(() => {
    if (!selectedTool) return [];
    const assignedIds = new Set(selectedTool.assigned_agents.map((agent) => agent.agent_id));
    return agents.filter((agent) => !assignedIds.has(agent.id));
  }, [agents, selectedTool]);

  const focusTool = (toolId: string | null) => {
    const nextParams = new URLSearchParams(searchParams);
    if (toolId) nextParams.set('tool', toolId);
    else nextParams.delete('tool');
    setSearchParams(nextParams);
  };

  const resetCreateDraft = () => setCreateDraft(defaultCreateDraft);

  const handleCreateTool = async () => {
    if (!selectedCompanyId) return;
    setSaving(true);
    setMutationError(null);
    setMutationMessage(null);

    try {
      const config = parseJsonInput(createDraft.configText, 'Create tool config');
      const response = (await request(`/companies/${selectedCompanyId}/tools`, {
        method: 'POST',
        body: JSON.stringify({
          company_id: selectedCompanyId,
          name: createDraft.name,
          description: createDraft.description || undefined,
          type: createDraft.type,
          config,
        }),
      })) as Tool;

      await reloadTools();
      focusTool(response.id);
      resetCreateDraft();
      setMutationMessage(`Created tool ${response.name}.`);
    } catch (err: any) {
      setMutationError(err.message || 'Failed to create tool.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateTool = async () => {
    if (!selectedCompanyId || !selectedTool) return;
    setSaving(true);
    setMutationError(null);
    setMutationMessage(null);

    try {
      const config = parseJsonInput(editDraft.configText, 'Edit tool config');
      await request(`/companies/${selectedCompanyId}/tools/${selectedTool.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editDraft.name,
          description: editDraft.description || null,
          type: editDraft.type,
          config,
        }),
      });
      await reloadTools();
      setMutationMessage(`Saved changes for ${editDraft.name}.`);
    } catch (err: any) {
      setMutationError(err.message || 'Failed to update tool.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTool = async () => {
    if (!selectedCompanyId || !selectedTool) return;
    if (!window.confirm(`Delete ${selectedTool.name}? This also removes assignments and call history.`)) return;

    setSaving(true);
    setMutationError(null);
    setMutationMessage(null);

    try {
      await request(`/companies/${selectedCompanyId}/tools/${selectedTool.id}`, { method: 'DELETE' });
      await reloadTools();
      focusTool(null);
      setMutationMessage(`Deleted tool ${selectedTool.name}.`);
    } catch (err: any) {
      setMutationError(err.message || 'Failed to delete tool.');
    } finally {
      setSaving(false);
    }
  };

  const handleSeedDefaults = async () => {
    if (!selectedCompanyId) return;
    setSeedingDefaults(true);
    setMutationError(null);
    setMutationMessage(null);

    try {
      const response = (await request(`/companies/${selectedCompanyId}/tools/seed`, {
        method: 'POST',
      })) as { inserted: string[]; existing: string[] };
      await reloadTools();
      setMutationMessage(`Seeded defaults: ${response.inserted.length} inserted, ${response.existing.length} already present.`);
    } catch (err: any) {
      setMutationError(err.message || 'Failed to seed default tools.');
    } finally {
      setSeedingDefaults(false);
    }
  };

  const handleAssignAgent = async () => {
    if (!selectedCompanyId || !selectedTool || assignAgentId === 'none') return;
    setSaving(true);
    setMutationError(null);
    setMutationMessage(null);

    try {
      await request(`/companies/${selectedCompanyId}/tools/${selectedTool.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ agent_id: assignAgentId }),
      });
      await Promise.all([reloadTools(), reloadAgents()]);
      setAssignAgentId('none');
      setMutationMessage('Assigned tool to agent.');
    } catch (err: any) {
      setMutationError(err.message || 'Failed to assign tool.');
    } finally {
      setSaving(false);
    }
  };

  const handleUnassignAgent = async (agentId: string) => {
    if (!selectedCompanyId || !selectedTool) return;
    setSaving(true);
    setMutationError(null);
    setMutationMessage(null);

    try {
      await request(`/companies/${selectedCompanyId}/tools/${selectedTool.id}/assign/${agentId}`, {
        method: 'DELETE',
      });
      await Promise.all([reloadTools(), reloadAgents()]);
      setMutationMessage('Removed tool assignment.');
    } catch (err: any) {
      setMutationError(err.message || 'Failed to remove assignment.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestTool = async () => {
    if (!selectedCompanyId || !selectedTool) return;
    setTestingTool(true);
    setMutationError(null);
    setMutationMessage(null);

    try {
      const input = parseJsonInput(testInputText, 'Tool test input');
      const response = (await request(
        `/companies/${selectedCompanyId}/tools/${selectedTool.id}/test`,
        {
          method: 'POST',
          body: JSON.stringify({ input }),
        },
        { suppressError: true }
      )) as ToolTestResult;
      setTestResult(response);
      setMutationMessage(`Tested ${selectedTool.name} successfully.`);
    } catch (err: any) {
      setTestResult({
        ok: false,
        duration_ms: 0,
        error: err.message || 'Tool test failed.',
      });
      setMutationError(err.message || 'Tool test failed.');
    } finally {
      setTestingTool(false);
    }
  };

  if (!selectedCompany) {
    return <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">Choose a company to review tools.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Tools</h2>
        <p className="text-sm text-muted-foreground">Executable capabilities assigned inside {selectedCompany.name}</p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {mutationError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{mutationError}</div>}
      {mutationMessage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {mutationMessage}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.95fr)]">
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Default bootstrap</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Seed safe built-in, HTTP, and bash tools for a new company.
              </div>
            </div>
            <button
              onClick={handleSeedDefaults}
              disabled={seedingDefaults}
              className="rounded-xl border px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {seedingDefaults ? 'Seeding defaults...' : 'Seed default tools'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="text-sm font-medium">Create tool</div>
          <div className="mt-1 text-xs text-muted-foreground">Register a new tool and focus it immediately.</div>
          <div className="mt-4 grid gap-3">
            <input
              aria-label="Create tool name"
              value={createDraft.name}
              onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="Tool name"
              className="rounded-xl border bg-background px-4 py-3 text-sm"
            />
            <input
              aria-label="Create tool description"
              value={createDraft.description}
              onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))}
              placeholder="What is this tool for?"
              className="rounded-xl border bg-background px-4 py-3 text-sm"
            />
            <select
              aria-label="Create tool type"
              value={createDraft.type}
              onChange={(event) => setCreateDraft((current) => ({ ...current, type: event.target.value as ToolDraft['type'] }))}
              className="rounded-xl border bg-background px-4 py-3 text-sm"
            >
              {typeFilters.filter((option): option is ToolDraft['type'] => option !== 'all').map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <textarea
              aria-label="Create tool config"
              value={createDraft.configText}
              onChange={(event) => setCreateDraft((current) => ({ ...current, configText: event.target.value }))}
              rows={7}
              className="rounded-xl border bg-background px-4 py-3 text-sm font-mono"
            />
            <div className="flex gap-3">
              <button
                onClick={handleCreateTool}
                disabled={saving || !createDraft.name.trim()}
                className="rounded-xl border px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create tool
              </button>
              <button
                onClick={resetCreateDraft}
                disabled={saving}
                className="rounded-xl border px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reset form
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_auto_auto]">
          <input
            aria-label="Search tools"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search tools, tasks, or agent names..."
            className="rounded-xl border bg-background px-4 py-3 text-sm"
          />
          <select
            aria-label="Filter tools by type"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as (typeof typeFilters)[number])}
            className="rounded-xl border bg-background px-4 py-3 text-sm"
          >
            {typeFilters.map((option) => <option key={option} value={option}>Type: {option}</option>)}
          </select>
          <select
            aria-label="Filter tools by status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as (typeof statusFilters)[number])}
            className="rounded-xl border bg-background px-4 py-3 text-sm"
          >
            {statusFilters.map((option) => <option key={option} value={option}>Status: {option}</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{filteredTools.length} tools match the current filters.</span>
          {selectedTool && (
            <button onClick={() => focusTool(null)} className="rounded-full border px-3 py-1 text-foreground transition-colors hover:bg-accent">
              Clear focused tool
            </button>
          )}
        </div>
      </div>

      {selectedTool && (
        <div className="rounded-2xl border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Focused Tool</div>
              <h3 className="mt-2 text-2xl font-semibold">{selectedTool.name}</h3>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{selectedTool.description || 'No description provided.'}</p>
            </div>
            <button onClick={() => focusTool(null)} className="rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent">
              Close detail
            </button>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-4">
            <div className="rounded-2xl border bg-muted/20 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Total calls</div>
              <div className="mt-2 text-2xl font-semibold">{selectedTool.usage.total_calls}</div>
            </div>
            <div className="rounded-2xl border bg-muted/20 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Success rate</div>
              <div className="mt-2 text-2xl font-semibold">
                {selectedTool.usage.total_calls > 0 ? `${Math.round((selectedTool.usage.success_count / selectedTool.usage.total_calls) * 100)}%` : '0%'}
              </div>
            </div>
            <div className="rounded-2xl border bg-muted/20 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Assigned agents</div>
              <div className="mt-2 text-2xl font-semibold">{selectedTool.agent_count}</div>
            </div>
            <div className="rounded-2xl border bg-muted/20 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Last called</div>
              <div className="mt-2 text-sm font-medium text-foreground">
                {selectedTool.usage.last_called_at ? new Date(selectedTool.usage.last_called_at).toLocaleString() : 'Never'}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <div className="rounded-2xl border bg-background p-4">
              <div className="text-sm font-medium">Tool configuration</div>
              <div className="mt-1 text-xs text-muted-foreground">Update the definition, config JSON, or remove this tool entirely.</div>
              <div className="mt-4 grid gap-3">
                <input
                  aria-label="Edit tool name"
                  value={editDraft.name}
                  onChange={(event) => setEditDraft((current) => ({ ...current, name: event.target.value }))}
                  className="rounded-xl border bg-background px-4 py-3 text-sm"
                />
                <input
                  aria-label="Edit tool description"
                  value={editDraft.description}
                  onChange={(event) => setEditDraft((current) => ({ ...current, description: event.target.value }))}
                  className="rounded-xl border bg-background px-4 py-3 text-sm"
                />
                <select
                  aria-label="Edit tool type"
                  value={editDraft.type}
                  onChange={(event) => setEditDraft((current) => ({ ...current, type: event.target.value as ToolDraft['type'] }))}
                  className="rounded-xl border bg-background px-4 py-3 text-sm"
                >
                  {typeFilters.filter((option): option is ToolDraft['type'] => option !== 'all').map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                <textarea
                  aria-label="Edit tool config"
                  value={editDraft.configText}
                  onChange={(event) => setEditDraft((current) => ({ ...current, configText: event.target.value }))}
                  rows={10}
                  className="rounded-xl border bg-background px-4 py-3 text-sm font-mono"
                />
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleUpdateTool}
                    disabled={saving || !editDraft.name.trim()}
                    className="rounded-xl border px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Save tool changes
                  </button>
                  <button
                    onClick={handleDeleteTool}
                    disabled={saving}
                    className="rounded-xl border border-red-300 px-4 py-2 text-sm text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Delete tool
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border bg-background p-4">
                <div className="text-sm font-medium">Assignments</div>
                <div className="mt-1 text-xs text-muted-foreground">Decide which agents can actually see and use this tool.</div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <select
                    aria-label="Assign tool to agent"
                    value={assignAgentId}
                    onChange={(event) => setAssignAgentId(event.target.value)}
                    className="min-w-[220px] rounded-xl border bg-background px-4 py-3 text-sm"
                  >
                    <option value="none">Choose agent to assign</option>
                    {availableAgentsForAssignment.map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleAssignAgent}
                    disabled={saving || assignAgentId === 'none'}
                    className="rounded-xl border px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Assign to agent
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  {selectedTool.assigned_agents.length > 0 ? (
                    selectedTool.assigned_agents.map((assignment) => (
                      <div key={assignment.agent_id} className="flex items-center justify-between gap-3 rounded-xl border bg-muted/10 p-3">
                        <div className="text-sm font-medium text-foreground">{assignment.agent_name}</div>
                        <button
                          onClick={() => handleUnassignAgent(assignment.agent_id)}
                          disabled={saving}
                          className="rounded-md border px-3 py-1.5 text-xs uppercase tracking-wide text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No agents are assigned to this tool yet.</div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border bg-background p-4">
                <div className="text-sm font-medium">Test tool</div>
                <div className="mt-1 text-xs text-muted-foreground">Run a dry test against the current config before assigning it broadly.</div>
                <textarea
                  aria-label="Tool test input"
                  value={testInputText}
                  onChange={(event) => setTestInputText(event.target.value)}
                  rows={7}
                  className="mt-4 w-full rounded-xl border bg-background px-4 py-3 text-sm font-mono"
                />
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    onClick={handleTestTool}
                    disabled={testingTool}
                    className="rounded-xl border px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {testingTool ? 'Testing tool...' : 'Run tool test'}
                  </button>
                </div>
                <div className="mt-4">
                  {testResult ? (
                    <div className="rounded-xl border bg-muted/20 p-4">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-wide ${testResult.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                          {testResult.ok ? 'success' : 'error'}
                        </span>
                        <span className="text-xs text-muted-foreground">{testResult.duration_ms} ms</span>
                      </div>
                      <pre className="mt-3 max-h-64 overflow-auto text-xs text-foreground">
                        <code>{formatJson(testResult.ok ? testResult.output ?? null : { error: testResult.error, output: testResult.output, status: testResult.status })}</code>
                      </pre>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No test run yet for this tool.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
            <div className="rounded-2xl border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">Execution history</div>
                  <div className="mt-1 text-xs text-muted-foreground">Full tool call log with server-side filters and pagination.</div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <select
                    aria-label="Filter history by status"
                    value={detailStatusFilter}
                    onChange={(event) => {
                      setDetailStatusFilter(event.target.value as (typeof detailStatusFilters)[number]);
                      setDetailPage(1);
                    }}
                    className="rounded-xl border bg-background px-3 py-2 text-sm"
                  >
                    {detailStatusFilters.map((option) => <option key={option} value={option}>History status: {option}</option>)}
                  </select>
                  <select
                    aria-label="Filter history by agent"
                    value={detailAgentFilter}
                    onChange={(event) => {
                      setDetailAgentFilter(event.target.value);
                      setDetailPage(1);
                    }}
                    className="rounded-xl border bg-background px-3 py-2 text-sm"
                  >
                    <option value="all">Agent: all</option>
                    {detailAgentOptions.map((agent) => <option key={agent.id} value={agent.id}>Agent: {agent.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="mt-4 grid gap-3 rounded-2xl border bg-muted/20 p-4 text-sm md:grid-cols-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Matching calls</div>
                  <div className="mt-2 text-lg font-semibold">{toolCallHistory?.summary.total_calls ?? selectedTool.usage.total_calls}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Success / error</div>
                  <div className="mt-2 text-lg font-semibold">
                    {(toolCallHistory?.summary.success_count ?? selectedTool.usage.success_count)} / {(toolCallHistory?.summary.error_count ?? selectedTool.usage.error_count)}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Current page</div>
                  <div className="mt-2 text-lg font-semibold">
                    {toolCallHistory?.pagination.total_pages ? `${toolCallHistory.pagination.page} / ${toolCallHistory.pagination.total_pages}` : '1 / 1'}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Last filtered call</div>
                  <div className="mt-2 text-sm font-medium text-foreground">
                    {toolCallHistory?.summary.last_called_at ? new Date(toolCallHistory.summary.last_called_at).toLocaleString() : 'Never'}
                  </div>
                </div>
              </div>

              {toolCallHistoryError && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{toolCallHistoryError}</div>}

              <div className="mt-4 space-y-3">
                {toolCallHistoryLoading ? (
                  <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Loading full tool history...</div>
                ) : toolCallHistory && toolCallHistory.items.length > 0 ? (
                  toolCallHistory.items.map((call) => (
                    <div key={call.id} className={`rounded-xl border p-3 text-sm transition-colors ${selectedHistoryCall?.id === call.id ? 'border-primary bg-primary/5' : 'bg-muted/10'}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="font-medium text-foreground">{call.task_title || 'No task title'}</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-wide ${call.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                            {call.status}
                          </span>
                          <button onClick={() => setSelectedCallId(call.id)} className="rounded-md border px-2.5 py-1 text-[11px] uppercase tracking-wide text-foreground transition-colors hover:bg-accent">
                            {selectedHistoryCall?.id === call.id ? 'Viewing payload' : 'Open payload'}
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>{call.agent_name || 'Unknown agent'}</span>
                        <span>{call.duration_ms ? `${call.duration_ms} ms` : 'No duration'}</span>
                        <span>{new Date(call.created_at).toLocaleString()}</span>
                        {call.agent_id && <Link className="text-foreground underline-offset-2 hover:underline" to={`/agents/${call.agent_id}`}>Agent profile</Link>}
                        {call.task_id && <Link className="text-foreground underline-offset-2 hover:underline" to={`/tasks/${call.task_id}`}>Task detail</Link>}
                      </div>
                      <div className="mt-3 rounded-xl border bg-background p-3">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Payload preview</div>
                        <pre className="mt-2 overflow-x-auto text-xs text-foreground"><code>{formatPayloadPreview(call.output)}</code></pre>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No tool calls match the current history filters.</div>
                )}
              </div>

              {toolCallHistory && toolCallHistory.pagination.total_pages > 1 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <div className="text-xs text-muted-foreground">
                    Showing page {toolCallHistory.pagination.page} of {toolCallHistory.pagination.total_pages} for {toolCallHistory.pagination.total} matching calls.
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setDetailPage((current) => Math.max(1, current - 1))}
                      disabled={toolCallHistory.pagination.page <= 1}
                      className="rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous page
                    </button>
                    <button
                      onClick={() => setDetailPage((current) => current + 1)}
                      disabled={!toolCallHistory.pagination.has_more}
                      className="rounded-md border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next page
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border bg-background p-4">
              <div className="text-sm font-medium">Selected call payload</div>
              <div className="mt-1 text-xs text-muted-foreground">Full input and output for the highlighted execution.</div>

              {selectedHistoryCall ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-xl border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-wide ${selectedHistoryCall.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {selectedHistoryCall.status}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-700">
                        {selectedHistoryCall.agent_name || 'Unknown agent'}
                      </span>
                    </div>
                    <div className="mt-3 text-sm font-medium text-foreground">{selectedHistoryCall.task_title || 'No task title'}</div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {selectedHistoryCall.duration_ms ? `${selectedHistoryCall.duration_ms} ms` : 'No duration'} | {new Date(selectedHistoryCall.created_at).toLocaleString()}
                    </div>
                  </div>

                  <div className="rounded-xl border bg-slate-950 p-4">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Full input</div>
                    <pre className="mt-3 max-h-64 overflow-auto text-xs text-slate-100"><code>{JSON.stringify(selectedHistoryCall.input ?? null, null, 2)}</code></pre>
                  </div>

                  <div className="rounded-xl border bg-slate-950 p-4">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Full output</div>
                    <pre className="mt-3 max-h-64 overflow-auto text-xs text-slate-100"><code>{JSON.stringify(selectedHistoryCall.output ?? null, null, 2)}</code></pre>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Pick a tool call to inspect its full payload.</div>
              )}

              <div className="mt-6 border-t pt-6">
                <div className="text-sm font-medium">Agent breakdown</div>
                <div className="mt-4 space-y-3">
                  {selectedToolAgentBreakdown.length > 0 ? (
                    selectedToolAgentBreakdown.map((entry) => (
                      <div key={entry.agent_name} className="rounded-xl border bg-muted/10 p-3">
                        <div className="font-medium text-foreground">{entry.agent_name}</div>
                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>{entry.total_calls} calls</span>
                          <span>{entry.success_count} success</span>
                          <span>{entry.error_count} error</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Agent breakdown appears after the first recorded executions.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredTools.map((tool) => {
          const Icon = typeIcon[tool.type] ?? Package2;
          const isSelected = tool.id === selectedToolId;

          return (
            <div key={tool.id} className={`rounded-2xl border bg-card p-5 shadow-sm transition-colors ${isSelected ? 'border-primary ring-2 ring-primary/10' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{tool.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{tool.description || 'No description provided.'}</div>
                </div>
                <div className="rounded-xl bg-muted p-3 text-muted-foreground">
                  <Icon className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between text-sm">
                <span className="rounded-full bg-muted px-2 py-1 uppercase tracking-wide text-muted-foreground">{tool.type}</span>
                <span className="text-muted-foreground">{tool.agent_count} assigned agents</span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {tool.assigned_agents.slice(0, 3).map((assignment) => (
                  <span key={assignment.agent_id} className="rounded-full bg-slate-100 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-700">
                    {assignment.agent_name}
                  </span>
                ))}
                {tool.assigned_agents.length > 3 && (
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-700">
                    +{tool.assigned_agents.length - 3} more
                  </span>
                )}
              </div>

              <div className="mt-5 grid gap-3 rounded-2xl border bg-muted/20 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Last status</span>
                  <span className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-wide ${
                    tool.usage.last_status === 'success'
                      ? 'bg-emerald-100 text-emerald-700'
                      : tool.usage.last_status === 'error'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}>
                    {tool.usage.last_status || 'unused'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Total calls</span>
                  <span className="text-foreground">{tool.usage.total_calls}</span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Success / errors</span>
                  <span className="text-foreground">{tool.usage.success_count} / {tool.usage.error_count}</span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Last called</span>
                  <span className="text-foreground">
                    {tool.usage.last_called_at ? new Date(tool.usage.last_called_at).toLocaleString() : 'Never'}
                  </span>
                </div>
              </div>

              <div className="mt-5">
                <button onClick={() => focusTool(tool.id)} className="w-full rounded-xl border px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent">
                  {isSelected ? 'Viewing details' : 'Open details'}
                </button>
              </div>

              <div className="mt-5 space-y-3">
                <div className="text-sm font-medium">Recent Calls</div>
                {tool.recent_calls.length > 0 ? (
                  tool.recent_calls.slice(0, 3).map((call) => (
                    <div key={call.id} className="rounded-xl border bg-muted/10 p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-foreground">{call.task_title || 'No task title'}</span>
                        <span className={`rounded-full px-2 py-1 text-[11px] uppercase tracking-wide ${
                          call.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {call.status}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>{call.agent_name || 'Unknown agent'}</span>
                        <span>{call.duration_ms ? `${call.duration_ms} ms` : 'No duration'}</span>
                        <span>{new Date(call.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No tool calls recorded yet.</div>
                )}
              </div>
            </div>
          );
        })}

        {tools.length === 0 && !loading && (
          <div className="col-span-full rounded-2xl border border-dashed p-12 text-center text-muted-foreground italic">
            No tools registered yet.
          </div>
        )}

        {tools.length > 0 && filteredTools.length === 0 && !loading && (
          <div className="col-span-full rounded-2xl border border-dashed p-12 text-center text-muted-foreground italic">
            No tools match the current filters.
          </div>
        )}
      </div>
    </div>
  );
}
