import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env.js';
import {
  AgentAction,
  AgentActionsSchema,
  AgentContext,
  AgentResponse,
  IAgentRuntime,
} from '../types/agent.js';
import { logger } from '../utils/logger.js';
import { defaultModelsByRuntime } from './defaultModels.js';
import { estimateUsageCostUsd } from './pricing.js';

const ACTION_TOOLS: Anthropic.Tool[] = [
  {
    name: 'complete_task',
    description:
      'Mark the current task as complete and provide the final result or deliverable.',
    input_schema: {
      type: 'object',
      properties: {
        result: {
          type: 'string',
          description:
            'Final outcome, answer, or artifact for the completed task.',
        },
      },
      required: ['result'],
      additionalProperties: false,
    },
  },
  {
    name: 'delegate',
    description:
      'Delegate a well-scoped subtask to another role when collaboration is needed.',
    input_schema: {
      type: 'object',
      properties: {
        to_role: {
          type: 'string',
          description: 'Target role that should own the delegated subtask.',
        },
        name: {
          type: 'string',
          description: 'Short name for the delegated work item.',
        },
        description: {
          type: 'string',
          description:
            'Clear description of what the delegated agent should do.',
        },
      },
      required: ['to_role', 'name', 'description'],
      additionalProperties: false,
    },
  },
  {
    name: 'message',
    description: 'Send a direct message to a specific teammate agent by id.',
    input_schema: {
      type: 'object',
      properties: {
        to_agent_id: {
          type: 'string',
          description: 'UUID of the teammate who should receive the message.',
        },
        content: {
          type: 'string',
          description: 'Message body to send to the teammate.',
        },
      },
      required: ['to_agent_id', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'use_tool',
    description:
      'Invoke one of the AVAILABLE TOOLS listed in the prompt. Only use a tool_name that is explicitly available to this agent.',
    input_schema: {
      type: 'object',
      properties: {
        tool_name: {
          type: 'string',
          description: 'Exact tool name from the AVAILABLE TOOLS section.',
        },
        params: {
          type: 'object',
          description: 'JSON object of parameters for the selected tool.',
          additionalProperties: true,
        },
      },
      required: ['tool_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'request_approval',
    description:
      'Request human approval before taking a sensitive or policy-gated action.',
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Why approval is required.',
        },
        payload: {
          type: 'object',
          description: 'Structured context for the approval request.',
          additionalProperties: true,
        },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'continue',
    description:
      'Keep working or wait for collaborators when no terminal action should happen yet.',
    input_schema: {
      type: 'object',
      properties: {
        thought: {
          type: 'string',
          description: 'Short explanation of the next step or waiting state.',
        },
      },
      required: ['thought'],
      additionalProperties: false,
    },
  },
];

function buildSystemPrompt(context: AgentContext): string {
  return `
You are ${context.agent_name}, a ${context.agent_role} at ${context.company_name}.
Company Mission: ${context.company_mission}

${context.agent_system_prompt || ''}

Current Goal Context: ${context.goal_hierarchy.join(' -> ')}
Your current task is: ${context.current_task.title}
Task Description: ${context.current_task.description || 'No description'}

${context.knowledge_context || ''}

${context.additional_context || ''}

Respond with:
1. brief natural-language reasoning in plain text, and
2. one or more action tool calls that describe exactly what should happen next.

Rules:
- Use the provided action tools instead of XML tags or JSON blobs.
- If the task is finished, call complete_task.
- If you need another agent, call delegate.
- If you need one of the AVAILABLE TOOLS, call use_tool.
- If you are waiting or still working, call continue.
- You may call multiple action tools in one response when needed.
`.trim();
}

function extractThought(blocks: Anthropic.ContentBlock[]): string {
  const thought = blocks
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return thought || 'Thinking through the next step.';
}

function parseActions(blocks: Anthropic.ContentBlock[]): AgentAction[] {
  const rawActions = blocks
    .filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    )
    .map((block) => ({
      type: block.name,
      ...(typeof block.input === 'object' && block.input !== null
        ? block.input
        : {}),
    }));

  if (rawActions.length === 0) {
    return [];
  }

  const validatedActions = AgentActionsSchema.safeParse(rawActions);
  if (validatedActions.success) {
    return validatedActions.data;
  }

  logger.error(
    { issues: validatedActions.error.issues, rawActions },
    'Claude tool_use actions failed schema validation'
  );
  return [];
}

export class ClaudeRuntime implements IAgentRuntime {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  async execute(context: AgentContext): Promise<AgentResponse> {
    const systemPrompt = buildSystemPrompt(context);

    const messages: Anthropic.MessageParam[] = context.history.map(
      (historyItem) => ({
        role: historyItem.role,
        content: historyItem.content,
      })
    );

    try {
      if (
        !env.ANTHROPIC_API_KEY ||
        env.ANTHROPIC_API_KEY === 'your_key_here' ||
        env.ANTHROPIC_API_KEY === ''
      ) {
        const mockModel = context.agent_model || defaultModelsByRuntime.claude;
        return {
          thought: 'Mock thought for testing',
          actions: [
            {
              type: 'complete_task',
              result: 'Mock generated mission statement',
            },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 10,
            cost_usd: estimateUsageCostUsd({
              runtime: 'claude',
              model: mockModel,
              inputTokens: 10,
              outputTokens: 10,
            }),
          },
        };
      }

      const model = context.agent_model || defaultModelsByRuntime.claude;
      const response = await this.client.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: ACTION_TOOLS,
        tool_choice: {
          type: 'any',
          disable_parallel_tool_use: false,
        },
      });

      const thought = extractThought(response.content);
      let actions = parseActions(response.content);

      if (actions.length === 0) {
        actions = [{ type: 'continue', thought }];
      }

      return {
        thought,
        actions,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          cost_usd: estimateUsageCostUsd({
            runtime: 'claude',
            model,
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          }),
        },
      };
    } catch (err) {
      logger.error({ err }, 'Claude execution failed');
      throw err;
    }
  }
}
