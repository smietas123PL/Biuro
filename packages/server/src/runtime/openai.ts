import OpenAI from 'openai';
import { env } from '../env.js';
import { AgentContext, AgentResponse, IAgentRuntime } from '../types/agent.js';
import { logger } from '../utils/logger.js';
import { defaultModelsByRuntime } from './defaultModels.js';
import { estimateUsageCostUsd } from './pricing.js';
import {
  buildStructuredRuntimeSystemPrompt,
  parseStructuredAgentResponse,
  structuredAgentResponseJsonSchema,
} from './structuredResponse.js';

export class OpenAIRuntime implements IAgentRuntime {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  async execute(context: AgentContext): Promise<AgentResponse> {
    const systemPrompt = buildStructuredRuntimeSystemPrompt(context);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...context.history.map((historyItem) => ({
        role: historyItem.role as 'user' | 'assistant',
        content: historyItem.content,
      })),
    ];

    try {
      const model = context.agent_model || defaultModelsByRuntime.openai;
      const response = await this.client.chat.completions.create({
        model,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'agent_runtime_response',
            description: 'Structured agent reasoning and actions.',
            schema: structuredAgentResponseJsonSchema,
            strict: true,
          },
        },
      });

      const text = response.choices[0]?.message.content || '';
      const { thought, actions } = parseStructuredAgentResponse(text, 'OpenAI');

      return {
        thought,
        actions,
        usage: {
          input_tokens: response.usage?.prompt_tokens || 0,
          output_tokens: response.usage?.completion_tokens || 0,
          cost_usd: estimateUsageCostUsd({
            runtime: 'openai',
            model,
            inputTokens: response.usage?.prompt_tokens || 0,
            outputTokens: response.usage?.completion_tokens || 0,
          }),
        },
      };
    } catch (err) {
      logger.error({ err }, 'OpenAI execution failed');
      throw err;
    }
  }
}
