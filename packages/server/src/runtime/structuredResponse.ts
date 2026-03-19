import { SchemaType, type ResponseSchema } from '@google/generative-ai';
import { z } from 'zod';
import { AgentActionsSchema, type AgentAction, type AgentContext } from '../types/agent.js';
import { logger } from '../utils/logger.js';

export const StructuredAgentResponseSchema = z.object({
  thought: z.string().min(1),
  actions: AgentActionsSchema.default([]),
});

export const structuredAgentResponseJsonSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    thought: {
      type: 'string',
      description: 'Brief natural-language reasoning summary for the next step.',
    },
    actions: {
      type: 'array',
      description: 'Ordered list of exact actions to execute next.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: ['complete_task', 'delegate', 'message', 'use_tool', 'request_approval', 'continue'],
          },
          result: { type: 'string' },
          to_role: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          to_agent_id: { type: 'string' },
          content: { type: 'string' },
          tool_name: { type: 'string' },
          params: {
            type: 'object',
            additionalProperties: true,
          },
          reason: { type: 'string' },
          payload: {
            type: 'object',
            additionalProperties: true,
          },
          thought: { type: 'string' },
        },
        required: ['type'],
      },
    },
  },
  required: ['thought', 'actions'],
};

export const structuredAgentResponseGeminiSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    thought: {
      type: SchemaType.STRING,
      description: 'Brief natural-language reasoning summary for the next step.',
    },
    actions: {
      type: SchemaType.ARRAY,
      description: 'Ordered list of exact actions to execute next.',
      items: {
        type: SchemaType.OBJECT,
        properties: {
          type: {
            type: SchemaType.STRING,
            format: 'enum',
            enum: ['complete_task', 'delegate', 'message', 'use_tool', 'request_approval', 'continue'],
          },
          result: { type: SchemaType.STRING, nullable: true },
          to_role: { type: SchemaType.STRING, nullable: true },
          name: { type: SchemaType.STRING, nullable: true },
          description: { type: SchemaType.STRING, nullable: true },
          to_agent_id: { type: SchemaType.STRING, nullable: true },
          content: { type: SchemaType.STRING, nullable: true },
          tool_name: { type: SchemaType.STRING, nullable: true },
          params: {
            type: SchemaType.OBJECT,
            properties: {},
            nullable: true,
          },
          reason: { type: SchemaType.STRING, nullable: true },
          payload: {
            type: SchemaType.OBJECT,
            properties: {},
            nullable: true,
          },
          thought: { type: SchemaType.STRING, nullable: true },
        },
        required: ['type'],
      },
    },
  },
  required: ['thought', 'actions'],
};

export function buildStructuredRuntimeSystemPrompt(context: AgentContext): string {
  return `
You are ${context.agent_name}, a ${context.agent_role} at ${context.company_name}.
Company Mission: ${context.company_mission}

${context.agent_system_prompt || ''}

Current Goal Context: ${context.goal_hierarchy.join(' -> ')}
Your current task is: ${context.current_task.title}
Task Description: ${context.current_task.description || 'No description'}

${context.knowledge_context || ''}

${context.additional_context || ''}

Return only JSON matching the provided schema.

Rules:
- "thought" must be a brief natural-language summary of your reasoning.
- "actions" must be an ordered list of exact next actions.
- If the task is finished, include a complete_task action.
- If you need another agent, include a delegate action.
- If you need one of the AVAILABLE TOOLS, include a use_tool action.
- If you are waiting or still working, include a continue action.
`.trim();
}

export function parseStructuredAgentResponse(rawText: string, runtimeName: string): { thought: string; actions: AgentAction[] } {
  try {
    const parsedJson = JSON.parse(rawText);
    const validated = StructuredAgentResponseSchema.safeParse(parsedJson);

    if (validated.success) {
      const thought = validated.data.thought.trim() || 'Thinking through the next step.';
      const actions: AgentAction[] =
        validated.data.actions.length > 0
          ? validated.data.actions
          : [{ type: 'continue', thought }];
      return { thought, actions };
    }

    logger.error({ issues: validated.error.issues, rawText }, `${runtimeName} structured response failed schema validation`);
  } catch (error) {
    logger.error({ error, rawText }, `Failed to parse ${runtimeName} structured response`);
  }

  const thought = rawText.trim() || 'Thinking through the next step.';
  return {
    thought,
    actions: [{ type: 'continue', thought }],
  };
}
