import OpenAI from 'openai';
import { env } from '../env.js';
import { AgentContext, AgentResponse, IAgentRuntime } from '../types/agent.js';
import { logger } from '../utils/logger.js';

export class OpenAIRuntime implements IAgentRuntime {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  async execute(context: AgentContext): Promise<AgentResponse> {
    const systemPrompt = `
You are ${context.agent_name}, a ${context.agent_role} at ${context.company_name}.
Company Mission: ${context.company_mission}

${context.agent_system_prompt || ''}

Current Goal Context: ${context.goal_hierarchy.join(' -> ')}
Your current task is: ${context.current_task.title}
Task Description: ${context.current_task.description || 'No description'}

Respond with your thought process AND specific actions in JSON format inside <thought> and <actions> tags.
`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...context.history.map(h => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      }))
    ];

    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-4o',
        messages,
      });

      const text = response.choices[0].message.content || '';
      
      const thoughtMatch = text.match(/<thought>([\s\S]*?)<\/thought>/);
      const actionsMatch = text.match(/<actions>([\s\S]*?)<\/actions>/);

      const thought = thoughtMatch ? thoughtMatch[1].trim() : text;
      let actions = [];

      if (actionsMatch) {
        try {
          actions = JSON.parse(actionsMatch[1].trim());
        } catch (e) {
          logger.error({ e, rawActions: actionsMatch[1] }, 'Failed to parse OpenAI actions');
        }
      }

      return {
        thought,
        actions,
        usage: {
          input_tokens: response.usage?.prompt_tokens || 0,
          output_tokens: response.usage?.completion_tokens || 0,
          cost_usd: ((response.usage?.prompt_tokens || 0) * 0.000005) + ((response.usage?.completion_tokens || 0) * 0.000015),
        }
      };
    } catch (err) {
      logger.error({ err }, 'OpenAI execution failed');
      throw err;
    }
  }
}
