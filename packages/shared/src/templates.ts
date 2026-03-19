export type TemplateSource = 'local' | 'marketplace';
export type TemplateMarketplaceSourceType = 'bundled' | 'remote';

export type CompanyTemplate = {
  version?: string;
  company: {
    name?: string;
    mission?: string | null;
  };
  roles?: Array<'owner' | 'admin' | 'member' | 'viewer'>;
  goals: Array<{
    title: string;
    description?: string | null;
    status?: 'active' | 'achieved' | 'abandoned';
  }>;
  policies: Array<{
    name: string;
    description?: string | null;
    type: 'approval_required' | 'budget_threshold' | 'delegation_limit' | 'rate_limit' | 'tool_restriction';
  }>;
  tools: Array<{
    name: string;
    description?: string | null;
    type: 'builtin' | 'http' | 'bash' | 'mcp';
  }>;
  agents: Array<{
    name: string;
    role: string;
    title?: string | null;
  }>;
  budgets?: Array<{
    agent_ref: string;
    limit_usd: number;
    spent_usd?: number;
  }>;
};

export type TemplateSummaryCounts = {
  goals: number;
  agents: number;
  tools: number;
  policies: number;
};

export type TemplateMarketplaceCatalog = {
  name: string;
  source_type: TemplateMarketplaceSourceType;
  source_url?: string | null;
};

export type TemplateMarketplaceSummary = {
  id: string;
  name: string;
  description: string;
  recommended_for: string;
  vendor: string;
  categories: string[];
  featured: boolean;
  badge: string | null;
  source_url: string | null;
  source_type: TemplateMarketplaceSourceType;
  summary: TemplateSummaryCounts;
};

export type TemplateMarketplaceDetail = TemplateMarketplaceSummary & {
  template: CompanyTemplate;
};

export type TemplateMarketplaceListResponse = {
  catalog: TemplateMarketplaceCatalog;
  templates: TemplateMarketplaceSummary[];
};

export type TemplateImportDryRun = {
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

export type TemplateMarketplaceDryRunResponse = {
  template: {
    id: string;
    name: string;
    vendor?: string;
    source_url?: string | null;
  };
  preview: TemplateImportDryRun;
};

export type TemplateAISuggestion = {
  title: string;
  description: string;
  priority: number;
  default_role: string | null;
  suggested_agent_id: string | null;
  suggested_agent_name: string | null;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
};

export type TemplateAISuggestPlanner = {
  mode: 'llm' | 'rules';
  runtime?: string;
  model?: string;
  fallback_reason?: 'llm_unavailable' | 'llm_failed' | 'invalid_llm_output' | null;
};

export type TemplateAISuggestResponse = {
  suggestion: TemplateAISuggestion;
  planner: TemplateAISuggestPlanner;
};
