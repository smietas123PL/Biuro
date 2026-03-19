import { useEffect, useMemo, useState } from 'react';
import type {
  GoalDecompositionDraftGoal,
  GoalDecompositionDraftTask,
  GoalDecompositionPlanner,
  GoalDecompositionSuggestResponse,
} from '@biuro/shared';
import { CheckCircle2, CircleDashed, GitBranchPlus, Sparkles } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useCompany } from '../context/CompanyContext';

type Goal = {
  id: string;
  parent_id?: string | null;
  title: string;
  description?: string | null;
  status: 'active' | 'achieved' | 'abandoned';
};

type GoalNode = Goal & {
  children: GoalNode[];
};

type AgentOption = {
  id: string;
  name: string;
  role: string;
  title?: string | null;
};

function buildGoalTree(goals: Goal[]): GoalNode[] {
  const nodeMap = new Map<string, GoalNode>();
  for (const goal of goals) {
    nodeMap.set(goal.id, { ...goal, children: [] });
  }

  const roots: GoalNode[] = [];
  for (const goal of goals) {
    const node = nodeMap.get(goal.id);
    if (!node) {
      continue;
    }

    if (goal.parent_id) {
      const parent = nodeMap.get(goal.parent_id);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }

    roots.push(node);
  }

  return roots;
}

function buildDraftTree(goals: GoalDecompositionDraftGoal[]) {
  const nodeMap = new Map<string, (GoalDecompositionDraftGoal & { children: GoalDecompositionDraftGoal[] })>();
  for (const goal of goals) {
    nodeMap.set(goal.ref, { ...goal, children: [] });
  }

  const roots: Array<GoalDecompositionDraftGoal & { children: GoalDecompositionDraftGoal[] }> = [];
  for (const goal of goals) {
    const node = nodeMap.get(goal.ref);
    if (!node) {
      continue;
    }

    if (goal.parent_ref) {
      const parent = nodeMap.get(goal.parent_ref);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }

    roots.push(node);
  }

  return roots;
}

function GoalTreeNode({ goal, depth }: { goal: GoalNode; depth: number }) {
  return (
    <div className="space-y-3">
      <div
        className="rounded-xl border bg-card px-5 py-4 shadow-sm"
        style={{ marginLeft: `${depth * 20}px` }}
      >
        <div className="flex gap-4">
          <div className="mt-1">
            {goal.status === 'achieved' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : (
              <CircleDashed className="h-5 w-5 text-slate-400" />
            )}
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-semibold">{goal.title}</div>
              <span className="rounded-full bg-muted px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">
                {goal.status}
              </span>
              {depth > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-1 text-xs text-sky-700">
                  <GitBranchPlus className="h-3.5 w-3.5" />
                  Child goal
                </span>
              )}
              {goal.children.length > 0 && (
                <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700">
                  {goal.children.length} subgoal{goal.children.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{goal.description || 'No description provided.'}</p>
          </div>
        </div>
      </div>

      {goal.children.map((child) => (
        <GoalTreeNode key={child.id} goal={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function DraftTreeNode({
  goal,
  depth,
  tasks,
  onChange,
  onTaskChange,
  agentOptions,
}: {
  goal: GoalDecompositionDraftGoal & { children: GoalDecompositionDraftGoal[] };
  depth: number;
  onChange: (ref: string, field: 'title' | 'description', value: string) => void;
  tasks: GoalDecompositionDraftTask[];
  onTaskChange: (
    ref: string,
    field: 'title' | 'description' | 'priority' | 'suggested_agent_id',
    value: string
  ) => void;
  agentOptions: AgentOption[];
}) {
  const starterTasks = tasks.filter((task) => task.goal_ref === goal.ref);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-background px-4 py-4" style={{ marginLeft: `${depth * 18}px` }}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
            {depth === 0 ? 'Root goal' : 'Subgoal'}
          </div>
          <span className="rounded-full bg-muted px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            {goal.status}
          </span>
        </div>
        <div className="mt-3 space-y-3">
          <input
            value={goal.title}
            onChange={(event) => onChange(goal.ref, 'title', event.target.value)}
            className="w-full rounded-md border bg-card px-3 py-2 text-sm font-medium"
          />
          <textarea
            value={goal.description}
            onChange={(event) => onChange(goal.ref, 'description', event.target.value)}
            className="min-h-[96px] w-full rounded-md border bg-card px-3 py-2 text-sm leading-7"
          />
        </div>

        {starterTasks.length > 0 && (
          <div className="mt-4 rounded-xl border bg-muted/20 p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Starter tasks</div>
            <div className="mt-3 space-y-3">
              {starterTasks.map((task) => (
                <div key={task.ref} className="rounded-lg border bg-card p-3">
                  <div className="grid gap-3 md:grid-cols-[1fr_110px]">
                    <input
                      value={task.title}
                      onChange={(event) => onTaskChange(task.ref, 'title', event.target.value)}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm font-medium"
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={task.priority}
                      onChange={(event) => onTaskChange(task.ref, 'priority', event.target.value)}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                  <select
                    value={task.suggested_agent_id || ''}
                    onChange={(event) => onTaskChange(task.ref, 'suggested_agent_id', event.target.value)}
                    className="mt-3 w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">No owner yet</option>
                    {agentOptions.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name} - {agent.title || agent.role}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={task.description}
                    onChange={(event) => onTaskChange(task.ref, 'description', event.target.value)}
                    className="mt-3 min-h-[82px] w-full rounded-md border bg-background px-3 py-2 text-sm leading-7"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {goal.children.map((child) => (
        <DraftTreeNode
          key={child.ref}
          goal={child as GoalDecompositionDraftGoal & { children: GoalDecompositionDraftGoal[] }}
          depth={depth + 1}
          tasks={tasks}
          onChange={onChange}
          onTaskChange={onTaskChange}
          agentOptions={agentOptions}
        />
      ))}
    </div>
  );
}

export default function GoalsPage() {
  const { request, loading, error } = useApi();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [aiPlanner, setAiPlanner] = useState<GoalDecompositionPlanner | null>(null);
  const [aiDraftGoals, setAiDraftGoals] = useState<GoalDecompositionDraftGoal[]>([]);
  const [aiDraftTasks, setAiDraftTasks] = useState<GoalDecompositionDraftTask[]>([]);
  const [aiDraftMeta, setAiDraftMeta] = useState<{
    title: string;
    description: string;
    confidence: 'high' | 'medium' | 'low';
    warnings: string[];
  } | null>(null);
  const goalTree = buildGoalTree(goals);
  const draftTree = useMemo(() => buildDraftTree(aiDraftGoals), [aiDraftGoals]);

  const fetchGoals = async () => {
    if (!selectedCompanyId) {
      setGoals([]);
      return;
    }

    const data = await request(`/companies/${selectedCompanyId}/goals`);
    setGoals(data);
  };

  const fetchAgents = async () => {
    if (!selectedCompanyId) {
      setAgentOptions([]);
      return;
    }

    const data = await request(`/companies/${selectedCompanyId}/agents`);
    setAgentOptions(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    void fetchGoals();
    void fetchAgents();
  }, [request, selectedCompanyId]);

  const suggestWithAI = async () => {
    if (!selectedCompanyId || !aiPrompt.trim()) {
      return;
    }

    setAiBusy(true);
    try {
      const result = (await request(`/companies/${selectedCompanyId}/goals/ai-decompose`, {
        method: 'POST',
        body: JSON.stringify({
          prompt: aiPrompt.trim(),
        }),
      })) as GoalDecompositionSuggestResponse;

      setAiDraftGoals(result.suggestion.goals);
      setAiDraftTasks(result.suggestion.starter_tasks);
      setAiDraftMeta({
        title: result.suggestion.title,
        description: result.suggestion.description,
        confidence: result.suggestion.confidence,
        warnings: result.suggestion.warnings,
      });
      setAiPlanner(result.planner);
      setSuccessMessage(null);
    } finally {
      setAiBusy(false);
    }
  };

  const updateDraftGoal = (ref: string, field: 'title' | 'description', value: string) => {
    setAiDraftGoals((current) =>
      current.map((goal) => (goal.ref === ref ? { ...goal, [field]: value } : goal))
    );
  };

  const updateDraftTask = (
    ref: string,
    field: 'title' | 'description' | 'priority' | 'suggested_agent_id',
    value: string
  ) => {
    setAiDraftTasks((current) =>
      current.map((task) =>
        task.ref === ref
          ? (() => {
              if (field === 'priority') {
                return {
                  ...task,
                  priority: Math.max(0, Math.min(100, Number(value) || 0)),
                };
              }

              if (field === 'suggested_agent_id') {
                const nextId = value || null;
                const nextAgent = agentOptions.find((agent) => agent.id === nextId) ?? null;
                return {
                  ...task,
                  suggested_agent_id: nextId,
                  suggested_agent_name: nextAgent?.name ?? null,
                };
              }

              return {
                ...task,
                [field]: value,
              };
            })()
          : task
      )
    );
  };

  const applyDecomposition = async () => {
    if (!selectedCompanyId || aiDraftGoals.length === 0 || !aiDraftMeta) {
      return;
    }

    setApplyBusy(true);
    try {
      const result = (await request(`/companies/${selectedCompanyId}/goals/ai-decompose/apply`, {
        method: 'POST',
        body: JSON.stringify({
          suggestion: {
            title: aiDraftMeta.title,
            description: aiDraftMeta.description,
            goals: aiDraftGoals,
            starter_tasks: aiDraftTasks,
            confidence: aiDraftMeta.confidence,
            warnings: aiDraftMeta.warnings,
          },
        }),
      })) as {
        created_goal_count: number;
        created_task_count: number;
      };

      await fetchGoals();
      setSuccessMessage(
        `Applied AI decomposition with ${result.created_goal_count} goals and ${result.created_task_count} starter task${result.created_task_count === 1 ? '' : 's'}.`
      );
      setAiPrompt('');
    } finally {
      setApplyBusy(false);
    }
  };

  if (!selectedCompany) {
    return <div className="rounded-xl border border-dashed p-8 text-sm text-muted-foreground">Choose a company to inspect goals.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Goals</h2>
          <p className="text-sm text-muted-foreground">Mission structure for {selectedCompany.name}</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-amber-500" />
          Autonomous Goal Decomposition MVP
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {successMessage && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div>}

      <div className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">AI Goal Decomposition</h3>
            <p className="text-sm text-muted-foreground">
              Describe a broad objective in plain language and get an editable goal tree before applying it.
            </p>
          </div>
          {aiPlanner && (
            <span className="rounded-full border bg-amber-50 px-3 py-1 text-xs text-amber-700">
              {aiPlanner.mode === 'llm' ? `Planned by ${aiPlanner.runtime || 'LLM'}` : 'Fallback decomposition'}
            </span>
          )}
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <label className="block text-sm font-medium text-foreground" htmlFor="goal-decomposition-prompt">
              Describe the mission in plain language
            </label>
            <textarea
              id="goal-decomposition-prompt"
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              placeholder="Example: launch our partner program in Q2 and keep ownership clear across sales, ops and onboarding"
              className="min-h-[160px] w-full rounded-2xl border bg-background px-4 py-3 text-sm leading-7 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void suggestWithAI()}
                disabled={aiBusy || aiPrompt.trim().length === 0}
                className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {aiBusy ? 'Generating...' : 'Generate Goal Tree'}
              </button>
              <div className="text-xs text-muted-foreground">
                Uses company runtime routing first, then falls back to a deterministic hierarchy.
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-muted/20 p-5">
            {aiDraftMeta && aiDraftGoals.length > 0 ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium text-foreground">AI-generated goal tree</div>
                  <div className="text-xs text-muted-foreground">
                    Confidence: {aiDraftMeta.confidence}
                  </div>
                </div>

                <div className="rounded-xl border bg-background p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Decomposition summary</div>
                  <div className="mt-2 text-base font-semibold text-foreground">{aiDraftMeta.title}</div>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">{aiDraftMeta.description}</p>
                </div>

                <div className="space-y-3">
                  {draftTree.map((goal) => (
                    <DraftTreeNode
                      key={goal.ref}
                      goal={goal}
                      depth={0}
                      tasks={aiDraftTasks}
                      onChange={updateDraftGoal}
                      onTaskChange={updateDraftTask}
                      agentOptions={agentOptions}
                    />
                  ))}
                </div>

                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full border bg-background px-2 py-1">
                    {aiDraftGoals.length} goals
                  </span>
                  <span className="rounded-full border bg-background px-2 py-1">
                    {aiDraftTasks.length} starter task{aiDraftTasks.length === 1 ? '' : 's'}
                  </span>
                </div>

                {aiDraftMeta.warnings.length > 0 && (
                  <div className="rounded-2xl border bg-amber-50/70 p-4">
                    <div className="text-sm font-medium text-amber-900">Planning warnings</div>
                    <div className="mt-2 space-y-2">
                      {aiDraftMeta.warnings.map((warning) => (
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
                    onClick={() => void applyDecomposition()}
                    disabled={
                      applyBusy ||
                      aiDraftGoals.some((goal) => goal.title.trim().length === 0) ||
                      aiDraftTasks.some((task) => task.title.trim().length === 0)
                    }
                    className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {applyBusy ? 'Applying...' : 'Apply Goal Tree'}
                  </button>
                  <div className="text-xs text-muted-foreground">
                    Creates the root goal and its subgoals in one pass.
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-dashed bg-background/50 p-8 text-center text-sm text-muted-foreground">
                Your suggested goal hierarchy will appear here.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-card shadow-sm">
        <div className="border-b px-6 py-4">
          <div className="text-sm text-muted-foreground">
            {loading ? 'Loading goals...' : `${goals.length} goal${goals.length === 1 ? '' : 's'} loaded`}
          </div>
        </div>

        <div className="space-y-3 p-4">
          {goalTree.map((goal) => (
            <GoalTreeNode key={goal.id} goal={goal} depth={0} />
          ))}

          {goalTree.length === 0 && !loading && (
            <div className="p-12 text-center text-muted-foreground italic">
              No goals defined yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
