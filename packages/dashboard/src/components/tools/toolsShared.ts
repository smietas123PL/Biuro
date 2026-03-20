import { Bot, Globe, Hammer, Package2 } from 'lucide-react';

export type ToolCall = {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  task_title: string | null;
  agent_name: string | null;
  status: 'success' | 'error';
  duration_ms: number | null;
  created_at: string;
};

export type AssignedAgent = {
  agent_id: string;
  agent_name: string;
};

export type Tool = {
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

export type CompanyAgent = {
  id: string;
  name: string;
  role?: string | null;
  status?: string | null;
};

export type ToolCallHistoryItem = ToolCall & {
  input: unknown;
  output: unknown;
};

export type ToolCallHistoryResponse = {
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

export type ToolDraft = {
  name: string;
  description: string;
  type: 'builtin' | 'http' | 'bash' | 'mcp';
  configText: string;
};

export type ToolTestResult = {
  ok: boolean;
  duration_ms: number;
  output?: unknown;
  error?: string | null;
  status?: number | null;
};

export const typeIcon = {
  builtin: Bot,
  http: Globe,
  bash: Hammer,
  mcp: Package2,
} as const;

export const typeFilters = ['all', 'builtin', 'http', 'bash', 'mcp'] as const;
export const statusFilters = ['all', 'success', 'error', 'unused'] as const;
export const detailStatusFilters = ['all', 'success', 'error'] as const;
export const TOOL_CALLS_PAGE_SIZE = 10;

export const defaultCreateDraft: ToolDraft = {
  name: '',
  description: '',
  type: 'builtin',
  configText: JSON.stringify({ builtin: 'web_search' }, null, 2),
};

export function formatPayloadPreview(payload: unknown) {
  if (payload === null || payload === undefined) return 'None';
  const serialized =
    typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  if (!serialized) return 'None';
  return serialized.length > 240
    ? `${serialized.slice(0, 240)}...`
    : serialized;
}

export function formatJson(value: unknown) {
  return JSON.stringify(value ?? null, null, 2);
}

export function parseJsonInput(value: string, label: string) {
  try {
    const trimmed = value.trim();
    return trimmed ? JSON.parse(trimmed) : {};
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}
