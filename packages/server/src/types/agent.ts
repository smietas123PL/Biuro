export type AgentAction =
  | { type: 'complete_task'; result: string }
  | { type: 'delegate'; to_role: string; name: string; description: string }
  | { type: 'message'; to_agent_id: string; content: string }
  | { type: 'use_tool'; tool_name: string; params: any }
  | { type: 'request_approval'; reason: string; payload: any }
  | { type: 'continue'; thought: string };

export interface AgentResponse {
  thought: string;
  actions: AgentAction[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  };
}

export interface AgentContext {
  company_name: string;
  company_mission: string;
  agent_name: string;
  agent_role: string;
  agent_system_prompt?: string;
  additional_context?: string;
  knowledge_context?: string;
  goal_hierarchy: string[]; // List of goal/parent titles
  current_task: {
    title: string;
    description?: string;
  };
  history: Array<{
    role: 'user' | 'assistant';
    content: string;
    metadata?: any;
  }>;
}

export interface IAgentRuntime {
  execute(context: AgentContext): Promise<AgentResponse>;
}
