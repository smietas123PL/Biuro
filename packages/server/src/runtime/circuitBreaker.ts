import { env } from '../env.js';
import type { RuntimeName } from './preferences.js';

type CircuitState = {
  consecutiveFailures: number;
  openUntil: number | null;
};

class RuntimeCircuitBreaker {
  private states = new Map<RuntimeName, CircuitState>();

  canAttempt(runtime: RuntimeName) {
    const state = this.states.get(runtime);
    if (!state?.openUntil) {
      return true;
    }

    if (Date.now() >= state.openUntil) {
      this.states.set(runtime, {
        consecutiveFailures: 0,
        openUntil: null,
      });
      return true;
    }

    return false;
  }

  getOpenRemainingMs(runtime: RuntimeName) {
    const state = this.states.get(runtime);
    if (!state?.openUntil) {
      return 0;
    }

    return Math.max(0, state.openUntil - Date.now());
  }

  recordSuccess(runtime: RuntimeName) {
    this.states.set(runtime, {
      consecutiveFailures: 0,
      openUntil: null,
    });
  }

  recordFailure(runtime: RuntimeName) {
    const current = this.states.get(runtime) ?? {
      consecutiveFailures: 0,
      openUntil: null,
    };
    const nextFailures = current.consecutiveFailures + 1;
    const shouldOpen =
      nextFailures >= env.LLM_CIRCUIT_BREAKER_FAILURE_THRESHOLD;

    this.states.set(runtime, {
      consecutiveFailures: shouldOpen ? 0 : nextFailures,
      openUntil: shouldOpen
        ? Date.now() + env.LLM_CIRCUIT_BREAKER_COOLDOWN_MS
        : null,
    });

    return shouldOpen;
  }
}

export const runtimeCircuitBreaker = new RuntimeCircuitBreaker();
