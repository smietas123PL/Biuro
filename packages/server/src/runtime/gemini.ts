import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../env.js';
import { AgentContext, AgentResponse, IAgentRuntime, AgentAction } from '../types/agent.js';
import { logger } from '../utils/logger.js';

// Gemini 2.0 Flash pricing (per million tokens) - adjusting to current standard
const COST_PER_MTK_INPUT = 0.10;
const COST_PER_MTK_OUTPUT = 0.40;

export class GeminiRuntime implements IAgentRuntime {
  private genAI: GoogleGenerativeAI;

  constructor() {
    if (!env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY is required for Gemini runtime');
    }
    this.genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
  }

  async execute(context: AgentContext): Promise<AgentResponse> {
    const model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const systemPrompt = `
You are ${context.agent_name}, a ${context.agent_role} at ${context.company_name}.
Company Mission: ${context.company_mission}

${context.agent_system_prompt || ''}

Current Goal Context: ${context.goal_hierarchy.join(' -> ')}
Your current task is: ${context.current_task.title}
Task Description: ${context.current_task.description || 'No description'}

Respond with your thought process AND specific actions in JSON format.
Include a <thought> block followed by an <actions> block containing a JSON array of actions.
Example:
<thought>Reasoning...</thought>
<actions>
[
  {"type": "complete_task", "result": "done"},
  {"type": "continue", "thought": "next step"}
]
</actions>
`;

    const chat = model.startChat({
      history: context.history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      })),
    });

    try {
      const result = await chat.sendMessage(systemPrompt);
      const response = await result.response;
      const text = response.text();

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const costUsd = (inputTokens / 1_000_000) * COST_PER_MTK_INPUT + (outputTokens / 1_000_000) * COST_PER_MTK_OUTPUT;

      const thoughtMatch = text.match(/<thought>([\s\S]*?)<\/thought>/);
      const actionsMatch = text.match(/<actions>([\s\S]*?)<\/actions>/);

      const thought = thoughtMatch ? thoughtMatch[1].trim() : text;
      let actions: AgentAction[] = [];

      if (actionsMatch) {
        try {
          // Some models might put code blocks in the XML
          const cleanedActions = actionsMatch[1].replace(/```json\n?|\n?```/g, '').trim();
          actions = JSON.parse(cleanedActions);
        } catch (e) {
          logger.error({ e, rawActions: actionsMatch[1] }, 'Failed to parse Gemini actions');
        }
      }

      if (actions.length === 0) {
        actions = [{ type: 'continue', thought: 'I will keep working on this.' }];
      }

      return {
        thought,
        actions,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cost_usd: costUsd,
        }
      };
    } catch (err) {
      logger.error({ err }, 'Gemini execution failed');
      throw err;
    }
  }
}
