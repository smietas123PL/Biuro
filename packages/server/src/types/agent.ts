import { z } from 'zod';

const ToolNameSchema = z.string().regex(/^[a-zA-Z0-9:_-]+$/);
const JsonRecordSchema = z.record(z.unknown());

export const AgentActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('complete_task'),
    result: z.string().min(1),
  }),
  z.object({
    type: z.literal('delegate'),
    to_role: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
  }),
  z.object({
    type: z.literal('message'),
    to_agent_id: z.string().uuid(),
    content: z.string().min(1),
  }),
  z.object({
    type: z.literal('use_tool'),
    tool_name: ToolNameSchema,
    params: JsonRecordSchema.default({}),
  }),
  z.object({
    type: z.literal('request_approval'),
    reason: z.string().min(1),
    payload: JsonRecordSchema.default({}),
  }),
  z.object({
    type: z.literal('continue'),
    thought: z.string().min(1),
  }),
]);

export const AgentActionsSchema = z.array(AgentActionSchema);

export type AgentAction =
  z.infer<typeof AgentActionSchema>;

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
  agent_model?: string;
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
