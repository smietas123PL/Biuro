import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pause, Play, UserMinus, Plus, X, GitBranchPlus } from 'lucide-react';
import { clsx } from 'clsx';
import { useApi } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';
import { useOnboarding } from '../context/OnboardingContext';

const initialForm = {
  name: '',
  role: '',
  title: '',
  runtime: 'gemini',
  system_prompt: '',
  monthly_budget_usd: '10',
  reports_to: '',
};

type AgentRecord = {
  id: string;
  name: string;
  role: string;
  title?: string | null;
  runtime: 'claude' | 'openai' | 'gemini' | string;
  system_prompt?: string | null;
  monthly_budget_usd?: number;
  reports_to?: string | null;
  status: 'idle' | 'working' | 'paused' | 'terminated' | string;
};

type AgentNode = AgentRecord & {
  children: AgentNode[];
};

function buildAgentTree(agents: AgentRecord[]) {
  const nodeMap = new Map<string, AgentNode>();
  for (const agent of agents) {
    nodeMap.set(agent.id, { ...agent, children: [] });
  }

  const roots: AgentNode[] = [];
  for (const agent of agents) {
    const node = nodeMap.get(agent.id);
    if (!node) {
      continue;
    }

    if (agent.reports_to) {
      const manager = nodeMap.get(agent.reports_to);
      if (manager) {
        manager.children.push(node);
        continue;
      }
    }

    roots.push(node);
  }

  return roots;
}

export default function AgentsPage() {
  const { request, loading, error } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { currentStep, status } = useOnboarding();
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [showHireModal, setShowHireModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(initialForm);
  const wasTutorialHireStepOpen = useRef(false);

  const tutorialWantsHireModal =
    status === 'active' && currentStep?.id === 'agents-hire-modal';

  const fetchAgents = async () => {
    if (!selectedCompanyId) {
      setAgents([]);
      return;
    }

    const data = await request(`/companies/${selectedCompanyId}/agents`);
    setAgents(data);
  };

  useEffect(() => {
    void fetchAgents();
  }, [selectedCompanyId]);

  useEffect(() => {
    if (tutorialWantsHireModal) {
      setShowHireModal(true);
      wasTutorialHireStepOpen.current = true;
      return;
    }

    if (wasTutorialHireStepOpen.current) {
      setShowHireModal(false);
      wasTutorialHireStepOpen.current = false;
    }
  }, [tutorialWantsHireModal]);

  const handleAction = async (
    agentId: string,
    action: 'pause' | 'resume' | 'terminate'
  ) => {
    await request(`/agents/${agentId}/${action}`, { method: 'POST' });
    await fetchAgents();
  };

  const handleHireAgent = async () => {
    if (!selectedCompanyId || !form.name.trim() || !form.role.trim()) return;

    setSubmitting(true);
    try {
      await request(`/companies/${selectedCompanyId}/agents`, {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.trim(),
          role: form.role.trim(),
          title: form.title.trim() || undefined,
          runtime: form.runtime,
          system_prompt: form.system_prompt.trim() || undefined,
          monthly_budget_usd: Number(form.monthly_budget_usd) || 0,
          reports_to: form.reports_to || undefined,
        }),
      });
      setForm(initialForm);
      setShowHireModal(false);
      await fetchAgents();
    } finally {
      setSubmitting(false);
    }
  };

  if (!selectedCompany) {
    return (
      <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">
        Choose a company to manage agents.
      </div>
    );
  }

  const activeAgents = agents.filter((agent) => agent.status !== 'terminated');
  const agentTree = buildAgentTree(activeAgents);
  const managerCount = activeAgents.filter((agent) =>
    activeAgents.some((candidate) => candidate.reports_to === agent.id)
  ).length;

  return (
    <div className="space-y-6">
      <div
        className="flex items-center justify-between"
        data-onboarding-target="agents-primary-actions"
      >
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Agents</h2>
          <p className="text-sm text-muted-foreground">
            Team for {selectedCompany.name}
          </p>
        </div>
        <button
          onClick={() => setShowHireModal(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Hire Agent
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div
        className="rounded-2xl border bg-card p-6 shadow-sm"
        data-onboarding-target="agents-organization-view"
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Organization View</h3>
            <p className="text-sm text-muted-foreground">
              Hierarchy built from `reports_to`, so you can see the team shape
              at a glance.
            </p>
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="rounded-full bg-muted px-3 py-1">
              {activeAgents.length} active agents
            </span>
            <span className="rounded-full bg-muted px-3 py-1">
              {managerCount} managers
            </span>
          </div>
        </div>

        <div className="space-y-3">
          {agentTree.map((agent) => (
            <AgentTreeNode key={agent.id} node={agent} depth={0} />
          ))}

          {agentTree.length === 0 && !loading && (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              No reporting structure yet. Assign managers when hiring agents to
              see the org chart here.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div className="border rounded-lg overflow-hidden bg-card">
          <table className="w-full text-left">
            <thead className="bg-muted/50 border-b text-sm font-medium text-muted-foreground">
              <tr>
                <th className="px-6 py-3">Name / Role</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Runtime</th>
                <th className="px-6 py-3">Manager</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {agents.map((agent) => (
                <tr
                  key={agent.id}
                  className="hover:bg-accent/50 transition-colors"
                >
                  <td className="px-6 py-4">
                    <Link
                      to={`/agents/${agent.id}`}
                      className="font-semibold text-foreground transition-colors hover:text-primary"
                    >
                      {agent.name}
                    </Link>
                    <div className="text-sm text-muted-foreground">
                      {agent.title || agent.role}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={clsx(
                        'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium capitalize',
                        agent.status === 'idle' &&
                          'bg-green-100 text-green-700',
                        agent.status === 'working' && 'bg-sky-100 text-sky-700',
                        agent.status === 'paused' &&
                          'bg-yellow-100 text-yellow-700',
                        agent.status === 'terminated' &&
                          'bg-red-100 text-red-700'
                      )}
                    >
                      {agent.status}
                    </span>
                  </td>
                  <td
                    className={clsx(
                      'px-6 py-4 font-mono text-sm font-medium',
                      agent.runtime === 'claude'
                        ? 'text-orange-600'
                        : agent.runtime === 'openai'
                          ? 'text-green-600'
                          : agent.runtime === 'gemini'
                            ? 'text-blue-600'
                            : 'text-gray-600'
                    )}
                  >
                    {agent.runtime}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {agents.find(
                      (candidate) => candidate.id === agent.reports_to
                    )?.name || 'None'}
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    {agent.status !== 'terminated' && (
                      <>
                        {agent.status === 'paused' ? (
                          <button
                            onClick={() =>
                              void handleAction(agent.id, 'resume')
                            }
                            className="p-2 hover:bg-green-50 text-green-600 rounded-md transition-colors"
                            title="Resume"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => void handleAction(agent.id, 'pause')}
                            className="p-2 hover:bg-yellow-50 text-yellow-600 rounded-md transition-colors"
                            title="Pause"
                          >
                            <Pause className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() =>
                            void handleAction(agent.id, 'terminate')
                          }
                          className="p-2 hover:bg-red-50 text-red-600 rounded-md transition-colors"
                          title="Terminate"
                        >
                          <UserMinus className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {agents.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-12 text-center text-muted-foreground italic"
                  >
                    No agents hired yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showHireModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            className="w-full max-w-2xl rounded-2xl border bg-card p-6 shadow-xl"
            data-onboarding-target="agents-hire-modal"
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold">Hire Agent</h3>
                <p className="text-sm text-muted-foreground">
                  Add a new teammate to {selectedCompany.name}
                </p>
              </div>
              <button
                onClick={() => setShowHireModal(false)}
                className="rounded-md p-2 hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <input
                id="agent-name"
                name="agentName"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Name"
                className="rounded-md border bg-background px-3 py-2 text-sm"
              />
              <input
                id="agent-role"
                name="agentRole"
                value={form.role}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    role: event.target.value,
                  }))
                }
                placeholder="Role"
                className="rounded-md border bg-background px-3 py-2 text-sm"
              />
              <input
                id="agent-title"
                name="agentTitle"
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Title"
                className="rounded-md border bg-background px-3 py-2 text-sm"
              />
              <select
                id="agent-runtime"
                name="agentRuntime"
                value={form.runtime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    runtime: event.target.value,
                  }))
                }
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="claude">Claude</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Gemini</option>
              </select>
              <input
                id="agent-monthly-budget"
                name="agentMonthlyBudgetUsd"
                value={form.monthly_budget_usd}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    monthly_budget_usd: event.target.value,
                  }))
                }
                placeholder="Monthly budget (USD)"
                type="number"
                min="0"
                step="0.01"
                className="rounded-md border bg-background px-3 py-2 text-sm"
              />
              <select
                id="agent-reports-to"
                name="agentReportsTo"
                value={form.reports_to}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    reports_to: event.target.value,
                  }))
                }
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">No manager</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
              <textarea
                id="agent-system-prompt"
                name="agentSystemPrompt"
                value={form.system_prompt}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    system_prompt: event.target.value,
                  }))
                }
                placeholder="System prompt (optional)"
                rows={4}
                className="md:col-span-2 rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowHireModal(false)}
                className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleHireAgent()}
                disabled={submitting || !form.name.trim() || !form.role.trim()}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Hiring...' : 'Hire Agent'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentTreeNode({ node, depth }: { node: AgentNode; depth: number }) {
  return (
    <div className="space-y-3">
      <div
        className="rounded-2xl border bg-muted/20 p-4 shadow-sm"
        style={{ marginLeft: `${depth * 20}px` }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/agents/${node.id}`}
                className="font-semibold text-foreground transition-colors hover:text-primary"
              >
                {node.name}
              </Link>
              <span className="rounded-full bg-background px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {node.runtime}
              </span>
              <span
                className={clsx(
                  'rounded-full px-2 py-1 text-[11px] uppercase tracking-wide',
                  node.status === 'working' && 'bg-sky-100 text-sky-700',
                  node.status === 'idle' && 'bg-emerald-100 text-emerald-700',
                  node.status === 'paused' && 'bg-amber-100 text-amber-700',
                  node.status === 'terminated' && 'bg-rose-100 text-rose-700'
                )}
              >
                {node.status}
              </span>
              {depth > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-[11px] text-sky-700">
                  <GitBranchPlus className="h-3.5 w-3.5" />
                  Reports into manager
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              {node.title || node.role}
            </div>
          </div>

          {node.children.length > 0 && (
            <div className="rounded-full bg-background px-3 py-1 text-xs text-muted-foreground">
              {node.children.length} direct report
              {node.children.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
      </div>

      {node.children.map((child) => (
        <AgentTreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}
