export type GoalDecompositionDraftGoal = {
  ref: string;
  parent_ref?: string | null;
  title: string;
  description: string;
  status: 'active' | 'achieved' | 'abandoned';
};

export type GoalDecompositionDraftTask = {
  ref: string;
  goal_ref: string;
  title: string;
  description: string;
  priority: number;
  suggested_agent_id: string | null;
  suggested_agent_name: string | null;
};

export type GoalDecompositionSuggestion = {
  title: string;
  description: string;
  goals: GoalDecompositionDraftGoal[];
  starter_tasks: GoalDecompositionDraftTask[];
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
};

export type GoalDecompositionPlanner = {
  mode: 'llm' | 'rules';
  runtime?: string;
  model?: string;
  fallback_reason?: 'llm_unavailable' | 'llm_failed' | 'invalid_llm_output' | null;
};

export type GoalDecompositionSuggestResponse = {
  suggestion: GoalDecompositionSuggestion;
  planner: GoalDecompositionPlanner;
};

export type GoalDecompositionApplyResponse = {
  ok: true;
  root_goal_id: string;
  created_goal_ids: string[];
  created_goal_count: number;
  created_task_ids: string[];
  created_task_count: number;
};
