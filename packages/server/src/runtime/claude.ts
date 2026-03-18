import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env.js';
import { AgentContext, AgentResponse, IAgentRuntime } from '../types/agent.js';
import { logger } from '../utils/logger.js';

export class ClaudeRuntime implements IAgentRuntime {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  async execute(context: AgentContext): Promise<AgentResponse> {
    const systemPrompt = `
You are ${context.agent_name}, a ${context.agent_role} at ${context.company_name}.
Company Mission: ${context.company_mission}

${context.agent_system_prompt || ''}

Current Goal Context: ${context.goal_hierarchy.join(' -> ')}
Your current task is: ${context.current_task.title}
Task Description: ${context.current_task.description || 'No description'}

Respond with your thought process AND specific actions in JSON format.
Example:
<thought>I need to plan the roadmap...</thought>
<actions>
[
  {"type": "delegate", "to_role": "cto", "name": "Technical Lead", "description": "Draft technical requirements"},
  {"type": "continue", "thought": "I will wait for the technical requirements."}
]
</actions>
`;

    const messages: Anthropic.MessageParam[] = context.history.map(h => ({
      role: h.role,
      content: h.content,
    }));

    try {
      if (!env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY === 'your_key_here' || env.ANTHROPIC_API_KEY === '') {
        // Mock response for tests
        return {
          thought: 'Mock thought for testing',
          actions: [{ type: 'complete_task', result: 'Mock generated mission statement' }],
          usage: { input_tokens: 10, output_tokens: 10, cost_usd: 0.0002 }
        };
      }

      const response = await this.client.messages.create({
        model: context.agent_model || 'claude-3-5-sonnet-20240620',
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      
      const thoughtMatch = text.match(/<thought>([\s\S]*?)<\/thought>/);
      const actionsMatch = text.match(/<actions>([\s\S]*?)<\/actions>/);

      const thought = thoughtMatch ? thoughtMatch[1].trim() : text;
      let actions = [];

      if (actionsMatch) {
        try {
          actions = JSON.parse(actionsMatch[1].trim());
        } catch (e) {
          logger.error({ e, rawActions: actionsMatch[1] }, 'Failed to parse Claude actions');
        }
      }

      return {
        thought,
        actions,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
          cost_usd: (response.usage.input_tokens * 0.000003) + (response.usage.output_tokens * 0.000015),
        }
      };
    } catch (err) {
      logger.error({ err }, 'Claude execution failed');
      throw err;
    }
  }
}
