import { env } from '../env.js';
import { startActiveSpan } from '../observability/tracing.js';
import { AgentContext, AgentResponse, IAgentRuntime } from '../types/agent.js';
import { logger } from '../utils/logger.js';
import { defaultModelsByRuntime } from './defaultModels.js';
import { runtimeCircuitBreaker } from './circuitBreaker.js';
import { isRuntimeName, type RuntimeName } from './preferences.js';

type RoutingAttempt = NonNullable<AgentResponse['routing']>['attempts'][number];

function isRetryableRuntimeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  return [
    '429',
    'quota',
    'rate limit',
    'temporarily unavailable',
    'timeout',
    'timed out',
    'overloaded',
    'try again',
    '503',
    '502',
    '504',
    'econnreset',
    'socket hang up',
  ].some((fragment) => normalized.includes(fragment));
}

function buildAttemptChain(
  preferredRuntime: string,
  availableRuntimes: RuntimeName[],
  fallbackOrderOverride?: RuntimeName[]
) {
  const configuredFallbacks =
    fallbackOrderOverride ??
    env.LLM_ROUTER_FALLBACK_ORDER.filter(isRuntimeName);
  const preferred = isRuntimeName(preferredRuntime) ? preferredRuntime : null;
  const chain = new Set<RuntimeName>();

  if (preferred && availableRuntimes.includes(preferred)) {
    chain.add(preferred);
  }

  for (const runtime of configuredFallbacks) {
    if (availableRuntimes.includes(runtime)) {
      chain.add(runtime);
    }
  }

  for (const runtime of availableRuntimes) {
    chain.add(runtime);
  }

  return Array.from(chain);
}

function resolveAttemptModel(
  preferredRuntime: string,
  attemptRuntime: RuntimeName,
  requestedModel?: string
) {
  if (attemptRuntime === preferredRuntime && requestedModel) {
    return requestedModel;
  }

  return defaultModelsByRuntime[attemptRuntime];
}

function resolveDirectRuntimeName(
  preferredRuntime: string,
  availableRuntimes: RuntimeName[]
) {
  if (
    isRuntimeName(preferredRuntime) &&
    availableRuntimes.includes(preferredRuntime)
  ) {
    return preferredRuntime;
  }

  return availableRuntimes[0] ?? null;
}

export class MultiProviderRuntimeRouter implements IAgentRuntime {
  constructor(
    private readonly preferredRuntime: string,
    private readonly runtimes: Map<RuntimeName, IAgentRuntime>,
    private readonly options?: {
      fallbackOrder?: RuntimeName[];
    }
  ) {}

  async execute(context: AgentContext): Promise<AgentResponse> {
    if (!env.LLM_ROUTER_ENABLED) {
      const runtimeName = resolveDirectRuntimeName(
        this.preferredRuntime,
        Array.from(this.runtimes.keys())
      );
      if (!runtimeName) {
        throw new Error('No LLM runtimes available');
      }
      const runtime = this.runtimes.get(runtimeName);
      if (!runtime) {
        throw new Error(`Runtime ${runtimeName} not available`);
      }

      const response = await runtime.execute(context);
      const selectedModel = resolveAttemptModel(
        this.preferredRuntime,
        runtimeName,
        context.agent_model
      );
      return {
        ...response,
        routing: {
          selected_runtime: runtimeName,
          selected_model: selectedModel,
          attempts: [
            {
              runtime: runtimeName,
              model: selectedModel,
              status: 'success',
            },
          ],
        },
      };
    }

    const availableRuntimes = Array.from(this.runtimes.keys());
    const attemptChain = buildAttemptChain(
      this.preferredRuntime,
      availableRuntimes,
      this.options?.fallbackOrder
    );
    if (attemptChain.length === 0) {
      throw new Error('No LLM runtimes available');
    }

    const attempts: RoutingAttempt[] = [];
    let lastError: unknown = null;

    for (let index = 0; index < attemptChain.length; index += 1) {
      const runtimeName = attemptChain[index];
      const runtime = this.runtimes.get(runtimeName);
      if (!runtime) {
        continue;
      }

      const model = resolveAttemptModel(
        this.preferredRuntime,
        runtimeName,
        context.agent_model
      );

      if (!runtimeCircuitBreaker.canAttempt(runtimeName)) {
        const remainingMs = runtimeCircuitBreaker.getOpenRemainingMs(runtimeName);
        attempts.push({
          runtime: runtimeName,
          model,
          status:
            index < attemptChain.length - 1
              ? 'fallback'
              : 'failed',
          reason: `Circuit breaker open for ${remainingMs}ms`,
        });
        logger.warn(
          {
            preferredRuntime: this.preferredRuntime,
            runtimeName,
            model,
            remainingMs,
          },
          'Skipping runtime because circuit breaker is open'
        );
        continue;
      }

      try {
        const response = await startActiveSpan(
          'llm.router.attempt',
          {
            'llm.preferred_runtime': this.preferredRuntime,
            'llm.attempt_runtime': runtimeName,
            'llm.attempt_index': index,
            'llm.model': model,
          },
          async (span) => {
            const routedContext: AgentContext = {
              ...context,
              agent_model: model,
            };
            const runtimeResponse = await runtime.execute(routedContext);
            span.setAttribute('llm.attempt_status', 'success');
            return runtimeResponse;
          }
        );

        attempts.push({
          runtime: runtimeName,
          model,
          status: 'success',
        });
        runtimeCircuitBreaker.recordSuccess(runtimeName);

        logger.info(
          {
            preferredRuntime: this.preferredRuntime,
            selectedRuntime: runtimeName,
            model,
            fallbackCount: attempts.length - 1,
          },
          'LLM router selected runtime'
        );

        return {
          ...response,
          routing: {
            selected_runtime: runtimeName,
            selected_model: model,
            attempts,
          },
        };
      } catch (error) {
        const retryable = isRetryableRuntimeError(error);
        const reason = error instanceof Error ? error.message : String(error);
        const breakerOpened = retryable
          ? runtimeCircuitBreaker.recordFailure(runtimeName)
          : false;
        attempts.push({
          runtime: runtimeName,
          model,
          status:
            retryable && index < attemptChain.length - 1
              ? 'fallback'
              : 'failed',
          reason,
        });
        lastError = error;

        logger.warn(
          {
            preferredRuntime: this.preferredRuntime,
            runtimeName,
            model,
            retryable,
            breakerOpened,
            reason,
          },
          retryable && index < attemptChain.length - 1
            ? 'LLM router falling back to next provider'
            : 'LLM router attempt failed'
        );

        if (!retryable || index === attemptChain.length - 1) {
          break;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? 'LLM routing failed'));
  }
}
