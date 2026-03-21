import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  PauseCircle,
  PlayCircle,
  Search,
  XCircle,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';
import type { CompanyRole } from '../context/CompanyContext';

type PaletteSection =
  | 'Pages'
  | 'Agents'
  | 'Tasks'
  | 'Goals'
  | 'Tools'
  | 'Approvals'
  | 'Quick Actions';

type NavigationPaletteItem = {
  kind: 'navigation';
  id: string;
  label: string;
  description: string;
  path: string;
  section: Exclude<PaletteSection, 'Quick Actions'>;
  keywords: string[];
};

type ActionPaletteItem = {
  kind: 'action';
  id: string;
  label: string;
  description: string;
  section: 'Quick Actions';
  keywords: string[];
  confirm_title: string;
  confirm_description: string;
  endpoint: string;
  method: 'POST';
  body?: Record<string, unknown>;
  success_message: string;
  accent: 'amber' | 'emerald' | 'red';
};

type PaletteItem = NavigationPaletteItem | ActionPaletteItem;

type AgentItem = {
  id: string;
  name: string;
  role: string;
  title?: string | null;
  status: string;
};

type TaskItem = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
};

type GoalItem = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
};

type ToolItem = {
  id: string;
  name: string;
  description?: string | null;
  type: string;
};

type ApprovalItem = {
  id: string;
  reason: string;
  status: string;
};

type NLCommandPlanAction =
  | {
      id: string;
      type: 'navigate';
      label: string;
      description: string;
      path: string;
      requires_confirmation: boolean;
    }
  | {
      id: string;
      type: 'api_request';
      label: string;
      description: string;
      endpoint: string;
      method: 'GET' | 'POST' | 'PATCH';
      body?: Record<string, unknown>;
      requires_confirmation: boolean;
      success_message: string;
    };

type NLCommandPlan = {
  source: 'rules' | 'llm';
  original_input: string;
  summary: string;
  reasoning: string;
  warnings: string[];
  can_execute: boolean;
  actions: NLCommandPlanAction[];
  planner: {
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
};

type PlanExecutionState = 'pending' | 'running' | 'completed' | 'failed';

function canManageCompany(role?: CompanyRole | null) {
  return role === 'owner' || role === 'admin';
}

function getStaticItems(role?: CompanyRole | null): NavigationPaletteItem[] {
  const items: NavigationPaletteItem[] = [
    {
      kind: 'navigation',
      id: 'page-dashboard',
      label: 'Dashboard',
      description: 'Company overview and live metrics',
      path: '/',
      section: 'Pages',
      keywords: ['overview', 'home', 'metrics'],
    },
    {
      kind: 'navigation',
      id: 'page-agents',
      label: 'Agents',
      description: 'Team roster and hierarchy',
      path: '/agents',
      section: 'Pages',
      keywords: ['people', 'org chart', 'team'],
    },
    {
      kind: 'navigation',
      id: 'page-tasks',
      label: 'Tasks',
      description: 'Backlog and current execution',
      path: '/tasks',
      section: 'Pages',
      keywords: ['work', 'backlog'],
    },
    {
      kind: 'navigation',
      id: 'page-goals',
      label: 'Goals',
      description: 'Goal tree and mission structure',
      path: '/goals',
      section: 'Pages',
      keywords: ['strategy', 'objectives'],
    },
    {
      kind: 'navigation',
      id: 'page-org-chart',
      label: 'Org Chart',
      description: 'Reporting lines and company hierarchy',
      path: '/org-chart',
      section: 'Pages',
      keywords: ['hierarchy', 'reports_to', 'team structure'],
    },
    {
      kind: 'navigation',
      id: 'page-digital-twin',
      label: 'Digital Twin',
      description: 'Live 3D flow map of tasks, data, and cost telemetry',
      path: '/digital-twin',
      section: 'Pages',
      keywords: ['graph', 'realtime', 'flow', 'telemetry'],
    },
    {
      kind: 'navigation',
      id: 'page-budgets',
      label: 'Budgets',
      description: 'Spend, caps and monthly forecast',
      path: '/budgets',
      section: 'Pages',
      keywords: ['costs', 'forecast', 'usage'],
    },
    {
      kind: 'navigation',
      id: 'page-templates',
      label: 'Templates',
      description: 'Local preset library and company setup imports',
      path: '/templates',
      section: 'Pages',
      keywords: ['presets', 'marketplace', 'setup'],
    },
    {
      kind: 'navigation',
      id: 'page-integrations',
      label: 'Integrations',
      description: 'Slack and Discord setup overview',
      path: '/integrations',
      section: 'Pages',
      keywords: ['slack', 'discord', 'webhooks'],
    },
    {
      kind: 'navigation',
      id: 'page-tools',
      label: 'Tools',
      description: 'Registered tools and capabilities',
      path: '/tools',
      section: 'Pages',
      keywords: ['tooling', 'capabilities'],
    },
    {
      kind: 'navigation',
      id: 'page-observability',
      label: 'Observability',
      description: 'Recent traces, span detail, and Grafana handoff',
      path: '/observability',
      section: 'Pages',
      keywords: ['traces', 'otel', 'grafana', 'tempo'],
    },
  ];

  if (canManageCompany(role)) {
    items.push(
      {
        kind: 'navigation',
        id: 'page-approvals',
        label: 'Approvals',
        description: 'Pending governance decisions',
        path: '/approvals',
        section: 'Pages',
        keywords: ['governance', 'review'],
      },
      {
        kind: 'navigation',
        id: 'page-audit',
        label: 'Audit Log',
        description: 'Recent operational events',
        path: '/audit',
        section: 'Pages',
        keywords: ['events', 'history', 'logs'],
      }
    );
  }

  return items;
}

function buildAgentActionItems(agents: AgentItem[]): ActionPaletteItem[] {
  const actionItems: ActionPaletteItem[] = [];

  for (const agent of agents) {
    if (agent.status === 'paused') {
      actionItems.push({
        kind: 'action',
        id: `action-agent-resume-${agent.id}`,
        label: `Resume ${agent.name}`,
        description: `Set ${agent.name} back to idle from paused status.`,
        section: 'Quick Actions',
        keywords: [agent.name, agent.role, 'resume', 'agent'],
        confirm_title: `Resume ${agent.name}?`,
        confirm_description:
          'This will set the agent status back to idle. It does not change tasks, budgets or hierarchy.',
        endpoint: `/agents/${agent.id}/resume`,
        method: 'POST',
        success_message: `${agent.name} was resumed.`,
        accent: 'emerald',
      });
      continue;
    }

    actionItems.push({
      kind: 'action',
      id: `action-agent-pause-${agent.id}`,
      label: `Pause ${agent.name}`,
      description: `Pause ${agent.name} while keeping current records intact.`,
      section: 'Quick Actions',
      keywords: [agent.name, agent.role, 'pause', 'agent'],
      confirm_title: `Pause ${agent.name}?`,
      confirm_description:
        'This only changes the agent status to paused. No tasks, tools or budgets are deleted.',
      endpoint: `/agents/${agent.id}/pause`,
      method: 'POST',
      success_message: `${agent.name} was paused.`,
      accent: 'amber',
    });
  }

  return actionItems;
}

function buildApprovalActionItems(
  approvals: ApprovalItem[]
): ActionPaletteItem[] {
  return approvals
    .filter((approval) => approval.status === 'pending')
    .flatMap((approval) => [
      {
        kind: 'action',
        id: `action-approval-approve-${approval.id}`,
        label: `Approve: ${approval.reason}`,
        description:
          'Resolve this approval as approved with an explicit confirmation step.',
        section: 'Quick Actions',
        keywords: [approval.reason, 'approve', 'approval', 'governance'],
        confirm_title: 'Approve this request?',
        confirm_description:
          'This will mark the approval as approved and continue the waiting workflow.',
        endpoint: `/approvals/${approval.id}/resolve`,
        method: 'POST',
        body: {
          status: 'approved',
          notes: 'Resolved via Command Palette',
        },
        success_message: 'Approval marked as approved.',
        accent: 'emerald',
      },
      {
        kind: 'action',
        id: `action-approval-reject-${approval.id}`,
        label: `Reject: ${approval.reason}`,
        description:
          'Resolve this approval as rejected with an explicit confirmation step.',
        section: 'Quick Actions',
        keywords: [approval.reason, 'reject', 'approval', 'governance'],
        confirm_title: 'Reject this request?',
        confirm_description:
          'This will mark the approval as rejected and keep the decision visible in the approvals log.',
        endpoint: `/approvals/${approval.id}/resolve`,
        method: 'POST',
        body: {
          status: 'rejected',
          notes: 'Resolved via Command Palette',
        },
        success_message: 'Approval marked as rejected.',
        accent: 'red',
      },
    ]);
}

function getAccentStyles(accent: ActionPaletteItem['accent']) {
  if (accent === 'emerald') {
    return {
      panel: 'border-emerald-200 bg-emerald-50/70',
      badge: 'bg-emerald-100 text-emerald-700',
      button: 'bg-emerald-600 text-white hover:bg-emerald-700',
    };
  }

  if (accent === 'red') {
    return {
      panel: 'border-red-200 bg-red-50/70',
      badge: 'bg-red-100 text-red-700',
      button: 'bg-red-600 text-white hover:bg-red-700',
    };
  }

  return {
    panel: 'border-amber-200 bg-amber-50/70',
    badge: 'bg-amber-100 text-amber-700',
    button: 'bg-amber-600 text-white hover:bg-amber-700',
  };
}

function getExecutionBadgeClass(status?: PlanExecutionState) {
  if (status === 'completed') {
    return 'bg-emerald-100 text-emerald-700';
  }

  if (status === 'running') {
    return 'bg-sky-100 text-sky-700';
  }

  if (status === 'failed') {
    return 'bg-red-100 text-red-700';
  }

  return 'bg-muted text-muted-foreground';
}

function getExecutionLabel(status?: PlanExecutionState) {
  if (status === 'completed') {
    return 'Done';
  }

  if (status === 'running') {
    return 'Running';
  }

  if (status === 'failed') {
    return 'Failed';
  }

  return 'Pending';
}

function getPlannerRuntimeLabel(runtime?: string) {
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

function getPlannerBadge(plan: NLCommandPlan) {
  if (plan.planner.mode === 'llm' && plan.planner.runtime) {
    return `Planned by ${getPlannerRuntimeLabel(plan.planner.runtime)}`;
  }

  if (plan.planner.fallback_reason === 'invalid_llm_plan') {
    return 'Fallback to Rules';
  }

  if (plan.planner.fallback_reason === 'llm_failed') {
    return 'Rules after LLM error';
  }

  return 'Planned by Rules';
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { request } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const companyRole = selectedCompany?.role ?? null;
  const companyCanManage = canManageCompany(companyRole);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PaletteItem[]>(
    getStaticItems(companyRole)
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingAction, setPendingAction] = useState<ActionPaletteItem | null>(
    null
  );
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [nlLoading, setNlLoading] = useState(false);
  const [nlPlan, setNlPlan] = useState<NLCommandPlan | null>(null);
  const [nlExecutionLoading, setNlExecutionLoading] = useState(false);
  const [nlExecutionError, setNlExecutionError] = useState<string | null>(null);
  const [nlExecutionState, setNlExecutionState] = useState<
    Record<string, PlanExecutionState>
  >({});

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
      setPendingAction(null);
      setActionMessage(null);
      setNlPlan(null);
      setNlExecutionLoading(false);
      setNlExecutionError(null);
      setNlExecutionState({});
      return;
    }

    const loadItems = async () => {
      const staticItems = getStaticItems(companyRole);

      if (!selectedCompanyId) {
        setItems(staticItems);
        return;
      }

      setLoading(true);
      try {
        const [agents, tasks, goals, tools, approvals] = await Promise.all([
          request(`/companies/${selectedCompanyId}/agents`) as Promise<
            AgentItem[]
          >,
          request(`/companies/${selectedCompanyId}/tasks`) as Promise<
            TaskItem[]
          >,
          request(`/companies/${selectedCompanyId}/goals`) as Promise<
            GoalItem[]
          >,
          request(`/companies/${selectedCompanyId}/tools`) as Promise<
            ToolItem[]
          >,
          companyCanManage
            ? (request(`/companies/${selectedCompanyId}/approvals`) as Promise<
                ApprovalItem[]
              >)
            : Promise.resolve([] as ApprovalItem[]),
        ]);

        const dynamicItems: PaletteItem[] = [
          ...agents.map((agent) => ({
            kind: 'navigation' as const,
            id: `agent-${agent.id}`,
            label: agent.name,
            description: `${agent.title || agent.role} - ${agent.status}`,
            path: `/agents/${agent.id}`,
            section: 'Agents' as const,
            keywords: [agent.role, agent.title || '', agent.status],
          })),
          ...tasks.map((task) => ({
            kind: 'navigation' as const,
            id: `task-${task.id}`,
            label: task.title,
            description: task.description || `Task in status ${task.status}`,
            path: `/tasks/${task.id}`,
            section: 'Tasks' as const,
            keywords: [task.status],
          })),
          ...goals.map((goal) => ({
            kind: 'navigation' as const,
            id: `goal-${goal.id}`,
            label: goal.title,
            description: goal.description || `Goal with status ${goal.status}`,
            path: '/goals',
            section: 'Goals' as const,
            keywords: [goal.status],
          })),
          ...tools.map((tool) => ({
            kind: 'navigation' as const,
            id: `tool-${tool.id}`,
            label: tool.name,
            description: tool.description || `${tool.type} tool`,
            path: `/tools?tool=${tool.id}`,
            section: 'Tools' as const,
            keywords: [tool.type],
          })),
          ...(companyCanManage
            ? approvals.map((approval) => ({
                kind: 'navigation' as const,
                id: `approval-${approval.id}`,
                label: approval.reason,
                description: `Approval status: ${approval.status}`,
                path: '/approvals',
                section: 'Approvals' as const,
                keywords: [approval.status],
              }))
            : []),
          ...(companyCanManage ? buildAgentActionItems(agents) : []),
          ...(companyCanManage ? buildApprovalActionItems(approvals) : []),
        ];

        setItems([...staticItems, ...dynamicItems]);
      } finally {
        setLoading(false);
      }
    };

    void loadItems();
  }, [
    companyCanManage,
    companyRole,
    open,
    refreshIndex,
    request,
    selectedCompanyId,
  ]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = items
    .filter((item) => {
      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        item.label,
        item.description,
        item.section,
        ...item.keywords,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .slice(0, 20);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  if (!open) {
    return null;
  }

  const resetPlanState = () => {
    setNlPlan(null);
    setNlExecutionLoading(false);
    setNlExecutionError(null);
    setNlExecutionState({});
  };

  const handleSelect = (item: PaletteItem) => {
    if (item.kind === 'action') {
      resetPlanState();
      setPendingAction(item);
      setActionMessage(null);
      return;
    }

    navigate(item.path);
    onClose();
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) {
      return;
    }

    setActionLoading(true);
    setActionMessage(null);
    try {
      await request(pendingAction.endpoint, {
        method: pendingAction.method,
        body: pendingAction.body
          ? JSON.stringify(pendingAction.body)
          : undefined,
      });
      setPendingAction(null);
      setActionMessage(pendingAction.success_message);
      setRefreshIndex((current) => current + 1);
    } finally {
      setActionLoading(false);
    }
  };

  const handleInterpretCommand = async () => {
    if (!selectedCompanyId || !query.trim()) {
      return;
    }

    setPendingAction(null);
    setActionMessage(null);
    setNlExecutionError(null);
    setNlExecutionState({});
    setNlLoading(true);
    try {
      const plan = (await request('/nl-command', {
        method: 'POST',
        body: JSON.stringify({ input: query.trim() }),
      })) as NLCommandPlan;
      setNlPlan(plan);
    } finally {
      setNlLoading(false);
    }
  };

  const handleExecutePlan = async () => {
    if (!nlPlan || nlExecutionLoading || !nlPlan.can_execute) {
      return;
    }

    setActionMessage(null);
    setNlExecutionError(null);
    setNlExecutionLoading(true);
    const initialState = Object.fromEntries(
      nlPlan.actions.map((action) => [
        action.id,
        'pending' as PlanExecutionState,
      ])
    );
    setNlExecutionState(initialState);

    try {
      let finalPath: string | null = null;
      let lastMessage = 'Plan completed.';

      for (const action of nlPlan.actions) {
        setNlExecutionState((current) => ({
          ...current,
          [action.id]: 'running',
        }));

        try {
          if (action.type === 'api_request') {
            await request(action.endpoint, {
              method: action.method,
              body: action.body ? JSON.stringify(action.body) : undefined,
            });
            lastMessage = action.success_message;
          } else {
            finalPath = action.path;
            lastMessage = `Opened ${action.label.replace(/^Open\s+/i, '')}.`;
          }

          setNlExecutionState((current) => ({
            ...current,
            [action.id]: 'completed',
          }));
        } catch (error) {
          setNlExecutionState((current) => ({
            ...current,
            [action.id]: 'failed',
          }));
          throw error;
        }
      }

      setActionMessage(lastMessage);
      setRefreshIndex((current) => current + 1);

      if (finalPath) {
        navigate(finalPath);
        onClose();
        return;
      }

      resetPlanState();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Plan execution failed.';
      setNlExecutionError(message);
    } finally {
      setNlExecutionLoading(false);
    }
  };

  const pendingActionStyles = pendingAction
    ? getAccentStyles(pendingAction.accent)
    : null;
  const planButtonDisabled = !selectedCompanyId || !query.trim() || nlLoading;
  const executePlanLabel =
    nlPlan?.actions.length === 1 && nlPlan.actions[0]?.type === 'navigate'
      ? 'Open page'
      : nlExecutionLoading
        ? 'Executing...'
        : 'Execute plan';

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/40 px-4 py-12 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-3xl overflow-hidden rounded-3xl border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b p-4">
          <div className="flex items-center gap-3 rounded-2xl border bg-background px-4 py-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              id="command-palette-query"
              name="commandPaletteQuery"
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (nlPlan || nlExecutionError) {
                  resetPlanState();
                }
              }}
              onKeyDown={(event) => {
                if (!pendingAction && !nlPlan && event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActiveIndex((current) =>
                    Math.min(current + 1, Math.max(filteredItems.length - 1, 0))
                  );
                }
                if (!pendingAction && !nlPlan && event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActiveIndex((current) => Math.max(current - 1, 0));
                }
                if (
                  !pendingAction &&
                  !nlPlan &&
                  (event.metaKey || event.ctrlKey) &&
                  event.key === 'Enter'
                ) {
                  event.preventDefault();
                  void handleInterpretCommand();
                  return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (pendingAction) {
                    void handleConfirmAction();
                    return;
                  }
                  if (filteredItems[activeIndex] && !nlPlan) {
                    handleSelect(filteredItems[activeIndex]);
                  }
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  if (pendingAction) {
                    setPendingAction(null);
                    return;
                  }
                  if (nlPlan) {
                    resetPlanState();
                    return;
                  }
                  onClose();
                }
              }}
              placeholder={
                selectedCompany
                  ? `Search ${selectedCompany.name} or type a command...`
                  : 'Search pages and records...'
              }
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => void handleInterpretCommand()}
              disabled={planButtonDisabled}
              className="rounded-md border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {nlLoading ? 'Planning...' : 'Plan'}
            </button>
            <div className="rounded-md border px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Esc
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {selectedCompany
                ? `Scope: ${selectedCompany.name}`
                : 'Scope: app-wide pages'}
            </span>
            <span>
              {loading
                ? 'Refreshing index...'
                : `${filteredItems.length} results`}
            </span>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Press{' '}
            <span className="font-medium text-foreground">Ctrl+Enter</span> to
            translate a natural-language command into an execution plan.
          </div>
          {!selectedCompany && (
            <div className="mt-3 rounded-2xl border border-dashed px-4 py-3 text-xs text-muted-foreground">
              Select a company to use natural language planning and execution.
            </div>
          )}
          {!companyCanManage && selectedCompany && (
            <div className="mt-3 rounded-2xl border border-dashed px-4 py-3 text-xs text-muted-foreground">
              Quick actions and governance entries are hidden for your role in{' '}
              {selectedCompany.name}, but you can still plan safe member
              actions.
            </div>
          )}
          {actionMessage && (
            <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {actionMessage}
            </div>
          )}
        </div>

        <div className="max-h-[60vh] overflow-auto p-3">
          {pendingAction && pendingActionStyles ? (
            <div
              className={`rounded-3xl border p-6 ${pendingActionStyles.panel}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${pendingActionStyles.badge}`}
                >
                  Confirmation required
                </span>
                <span className="rounded-full bg-white/70 px-3 py-1 text-xs text-muted-foreground">
                  Quick Actions
                </span>
              </div>

              <div className="mt-4">
                <div className="text-xl font-semibold text-foreground">
                  {pendingAction.confirm_title}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {pendingAction.confirm_description}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border bg-white/70 px-4 py-3 text-sm text-muted-foreground">
                {pendingAction.description}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={() => setPendingAction(null)}
                  disabled={actionLoading}
                  className="rounded-md border bg-background px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleConfirmAction()}
                  disabled={actionLoading}
                  className={`rounded-md px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${pendingActionStyles.button}`}
                >
                  {actionLoading ? 'Applying...' : 'Confirm action'}
                </button>
              </div>
            </div>
          ) : nlPlan ? (
            <div className="rounded-3xl border border-sky-200 bg-sky-50/70 p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700">
                  Natural Language Plan
                </span>
                <span className="rounded-full bg-white/70 px-3 py-1 text-xs text-muted-foreground">
                  Source: {nlPlan.source}
                </span>
                <span className="rounded-full bg-white/70 px-3 py-1 text-xs text-muted-foreground">
                  {getPlannerBadge(nlPlan)}
                </span>
                {nlPlan.planner.attempts &&
                  nlPlan.planner.attempts.length > 1 && (
                    <span className="rounded-full bg-white/70 px-3 py-1 text-xs text-muted-foreground">
                      Attempts: {nlPlan.planner.attempts.length}
                    </span>
                  )}
              </div>

              <div className="mt-4">
                <div className="text-xl font-semibold text-foreground">
                  {nlPlan.summary}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {nlPlan.reasoning}
                </div>
              </div>

              {nlPlan.actions.length > 0 && (
                <div className="mt-5 space-y-3">
                  {nlPlan.actions.map((action, index) => (
                    <div
                      key={action.id}
                      className="rounded-2xl border bg-white/80 px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-muted px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                              Step {index + 1}
                            </span>
                            <span className="font-medium text-foreground">
                              {action.label}
                            </span>
                            <span
                              className={`rounded-full px-2 py-1 text-[11px] font-medium ${getExecutionBadgeClass(nlExecutionState[action.id])}`}
                            >
                              {getExecutionLabel(nlExecutionState[action.id])}
                            </span>
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {action.description}
                          </div>
                        </div>
                        <span className="rounded-full bg-background px-3 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                          {action.type === 'navigate'
                            ? 'Navigate'
                            : action.method}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {nlPlan.warnings.length > 0 && (
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {nlPlan.warnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              )}

              {nlExecutionError && (
                <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {nlExecutionError}
                </div>
              )}

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={resetPlanState}
                  disabled={nlExecutionLoading}
                  className="rounded-md border bg-background px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleExecutePlan()}
                  disabled={!nlPlan.can_execute || nlExecutionLoading}
                  className="rounded-md bg-sky-600 px-4 py-2 text-sm text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {executePlanLabel}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredItems.map((item, index) => (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  className={`flex w-full items-start justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition-colors ${
                    index === activeIndex
                      ? 'border-primary bg-primary/5'
                      : 'border-transparent hover:bg-accent'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">
                        {item.label}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {item.section}
                      </span>
                      {item.kind === 'action' && (
                        <ActionIcon accent={item.accent} />
                      )}
                    </div>
                    <div className="mt-1 truncate text-sm text-muted-foreground">
                      {item.description}
                    </div>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                </button>
              ))}

              {filteredItems.length === 0 && (
                <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                  No matches for this query. Try the natural language planner
                  above.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionIcon({ accent }: { accent: ActionPaletteItem['accent'] }) {
  if (accent === 'emerald') {
    return <PlayCircle className="h-4 w-4 text-emerald-600" />;
  }

  if (accent === 'red') {
    return <XCircle className="h-4 w-4 text-red-600" />;
  }

  return <PauseCircle className="h-4 w-4 text-amber-600" />;
}
