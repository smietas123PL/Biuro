import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentContext,
  AgentResponse,
  IAgentRuntime,
} from '../src/types/agent.js';

const startActiveSpanMock = vi.hoisted(() => vi.fn());
const circuitBreakerMock = vi.hoisted(() => ({
  canAttempt: vi.fn(),
  getOpenRemainingMs: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
}));
const loggerInfoMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());

function createRuntime(
  execute: (context: AgentContext) => Promise<AgentResponse>
): IAgentRuntime {
  return { execute };
}

const baseContext: AgentContext = {
  company_name: 'QA Test Corp',
  company_mission: 'Ship stable software',
  agent_name: 'Ada',
  agent_role: 'operator',
  current_task: {
    title: 'Prepare launch brief',
    description: 'Summarize what should launch this week.',
  },
  goal_hierarchy: [],
  history: [],
};

async function loadRouterModule(routerEnabled: boolean) {
  vi.resetModules();

  vi.doMock('../src/env.js', () => ({
    env: {
      LLM_ROUTER_ENABLED: routerEnabled,
      LLM_ROUTER_FALLBACK_ORDER: ['openai', 'gemini', 'claude'],
      LLM_CIRCUIT_BREAKER_FAILURE_THRESHOLD: 3,
      LLM_CIRCUIT_BREAKER_COOLDOWN_MS: 60_000,
      CLAUDE_MODEL: 'claude-test',
      OPENAI_MODEL: 'openai-test',
      GEMINI_MODEL: 'gemini-test',
    },
  }));

  vi.doMock('../src/observability/tracing.js', () => ({
    startActiveSpan: startActiveSpanMock,
  }));

  vi.doMock('../src/runtime/circuitBreaker.js', () => ({
    runtimeCircuitBreaker: circuitBreakerMock,
  }));

  vi.doMock('../src/utils/logger.js', () => ({
    logger: {
      info: loggerInfoMock,
      warn: loggerWarnMock,
    },
  }));

  return import('../src/runtime/router.js');
}

describe('MultiProviderRuntimeRouter', () => {
  beforeEach(() => {
    startActiveSpanMock.mockReset();
    startActiveSpanMock.mockImplementation(
      async (
        _name: string,
        _attrs: Record<string, unknown>,
        fn: (span: { setAttribute: (key: string, value: string) => void }) => Promise<AgentResponse>
      ) =>
        fn({
          setAttribute: vi.fn(),
        })
    );
    circuitBreakerMock.canAttempt.mockReset();
    circuitBreakerMock.getOpenRemainingMs.mockReset();
    circuitBreakerMock.recordSuccess.mockReset();
    circuitBreakerMock.recordFailure.mockReset();
    circuitBreakerMock.canAttempt.mockReturnValue(true);
    circuitBreakerMock.getOpenRemainingMs.mockReturnValue(0);
    circuitBreakerMock.recordFailure.mockReturnValue(false);
    loggerInfoMock.mockReset();
    loggerWarnMock.mockReset();
  });

  afterEach(() => {
    vi.doUnmock('../src/env.js');
    vi.doUnmock('../src/observability/tracing.js');
    vi.doUnmock('../src/runtime/circuitBreaker.js');
    vi.doUnmock('../src/utils/logger.js');
    vi.resetModules();
  });

  it('falls back to the first available runtime when routing is disabled and the preferred runtime is unavailable', async () => {
    const { MultiProviderRuntimeRouter } = await loadRouterModule(false);
    const openAiExecute = vi.fn(async () => ({
      thought: 'Used OpenAI directly.',
      actions: [],
    }));

    const router = new MultiProviderRuntimeRouter(
      'gemini',
      new Map([
        ['openai', createRuntime(openAiExecute)],
        ['claude', createRuntime(async () => ({ thought: 'unused', actions: [] }))],
      ])
    );

    const response = await router.execute({
      ...baseContext,
      agent_model: 'gemini-custom',
    });

    expect(openAiExecute).toHaveBeenCalledTimes(1);
    expect(response.routing).toEqual({
      selected_runtime: 'openai',
      selected_model: 'openai-test',
      attempts: [
        {
          runtime: 'openai',
          model: 'openai-test',
          status: 'success',
        },
      ],
    });
  });

  it('falls back to the next provider on retryable errors', async () => {
    const { MultiProviderRuntimeRouter } = await loadRouterModule(true);
    const claudeExecute = vi.fn(async () => {
      throw new Error('429 rate limit');
    });
    const openAiExecute = vi.fn(async () => ({
      thought: 'Recovered through fallback.',
      actions: [],
    }));

    const router = new MultiProviderRuntimeRouter(
      'claude',
      new Map([
        ['claude', createRuntime(claudeExecute)],
        ['openai', createRuntime(openAiExecute)],
      ])
    );

    const response = await router.execute(baseContext);

    expect(circuitBreakerMock.recordFailure).toHaveBeenCalledWith('claude');
    expect(circuitBreakerMock.recordSuccess).toHaveBeenCalledWith('openai');
    expect(response.routing).toEqual({
      selected_runtime: 'openai',
      selected_model: 'openai-test',
      attempts: [
        {
          runtime: 'claude',
          model: 'claude-test',
          status: 'fallback',
          reason: '429 rate limit',
        },
        {
          runtime: 'openai',
          model: 'openai-test',
          status: 'success',
        },
      ],
    });
  });

  it('skips providers with an open circuit breaker and continues the chain', async () => {
    const { MultiProviderRuntimeRouter } = await loadRouterModule(true);
    circuitBreakerMock.canAttempt.mockImplementation(
      (runtime: string) => runtime !== 'claude'
    );
    circuitBreakerMock.getOpenRemainingMs.mockReturnValue(2500);

    const openAiExecute = vi.fn(async () => ({
      thought: 'Circuit breaker skip succeeded.',
      actions: [],
    }));

    const router = new MultiProviderRuntimeRouter(
      'claude',
      new Map([
        ['claude', createRuntime(async () => ({ thought: 'unused', actions: [] }))],
        ['openai', createRuntime(openAiExecute)],
      ])
    );

    const response = await router.execute(baseContext);

    expect(openAiExecute).toHaveBeenCalledTimes(1);
    expect(response.routing?.attempts).toEqual([
      {
        runtime: 'claude',
        model: 'claude-test',
        status: 'fallback',
        reason: 'Circuit breaker open for 2500ms',
      },
      {
        runtime: 'openai',
        model: 'openai-test',
        status: 'success',
      },
    ]);
  });
});
