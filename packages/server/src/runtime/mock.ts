import { AgentContext, AgentResponse, IAgentRuntime } from '../types/agent.js';

function buildMockResult(context: AgentContext) {
  const taskTitle = context.current_task.title.trim() || 'Untitled task';
  const companyName = context.company_name.trim() || 'the company';
  return `Mock execution completed "${taskTitle}" for ${companyName}.`;
}

export class MockRuntime implements IAgentRuntime {
  async execute(context: AgentContext): Promise<AgentResponse> {
    return {
      thought: `Mock runtime is simulating progress on "${context.current_task.title}".`,
      actions: [
        {
          type: 'complete_task',
          result: buildMockResult(context),
        },
      ],
      usage: {
        input_tokens: 96,
        output_tokens: 48,
        cost_usd: 0.0006,
      },
    };
  }
}
