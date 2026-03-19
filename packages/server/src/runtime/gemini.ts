import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../env.js';
import { AgentContext, AgentResponse, IAgentRuntime } from '../types/agent.js';
import { logger } from '../utils/logger.js';
import { defaultModelsByRuntime } from './defaultModels.js';
import { estimateUsageCostUsd } from './pricing.js';
import {
  buildStructuredRuntimeSystemPrompt,
  parseStructuredAgentResponse,
  structuredAgentResponseGeminiSchema,
} from './structuredResponse.js';

export class GeminiRuntime implements IAgentRuntime {
  private genAI: GoogleGenerativeAI;

  constructor() {
    if (!env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY is required for Gemini runtime');
    }
    this.genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
  }

  async execute(context: AgentContext): Promise<AgentResponse> {
    const systemPrompt = buildStructuredRuntimeSystemPrompt(context);
    const modelName = context.agent_model || defaultModelsByRuntime.gemini;
    const model = this.genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: structuredAgentResponseGeminiSchema,
      },
    });

    const history = context.history
      .map((entry) => ({
        role: entry.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: entry.content }],
      }))
      .filter((entry) => entry.parts[0]?.text.trim().length > 0);

    const firstUserMessageIndex = history.findIndex(
      (entry) => entry.role === 'user'
    );
    const filteredHistory =
      firstUserMessageIndex >= 0 ? history.slice(firstUserMessageIndex) : [];

    const chat = model.startChat({
      history: filteredHistory,
    });

    try {
      const result = await chat.sendMessage(
        context.current_task.description ||
          context.current_task.title ||
          'Continue the current task.'
      );
      const response = await result.response;
      const text = response.text();

      const inputTokens = response.usageMetadata?.promptTokenCount || 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
      const costUsd = estimateUsageCostUsd({
        runtime: 'gemini',
        model: modelName,
        inputTokens,
        outputTokens,
      });
      const { thought, actions } = parseStructuredAgentResponse(text, 'Gemini');

      return {
        thought,
        actions,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cost_usd: costUsd,
        },
      };
    } catch (err) {
      logger.error({ err }, 'Gemini execution failed');
      throw err;
    }
  }
}
