import { env } from '../env.js';
import type { RuntimeName } from '@biuro/shared';
export type { RuntimeName } from '@biuro/shared';

export const ALL_RUNTIMES: RuntimeName[] = ['gemini', 'claude', 'openai'];
export const DEFAULT_PRIMARY_RUNTIME: RuntimeName = 'gemini';

export function isRuntimeName(value: unknown): value is RuntimeName {
  return value === 'claude' || value === 'openai' || value === 'gemini';
}

export function normalizeRuntimeOrder(value: unknown, fallback: RuntimeName[] = ALL_RUNTIMES): RuntimeName[] {
  const rawValues = typeof value === 'string'
    ? value.split(',')
    : Array.isArray(value)
      ? value
      : [];

  const unique = new Set<RuntimeName>();

  for (const item of rawValues) {
    const trimmed = typeof item === 'string' ? item.trim() : '';
    if (isRuntimeName(trimmed)) {
      unique.add(trimmed);
    }
  }

  for (const runtime of fallback) {
    unique.add(runtime);
  }

  return Array.from(unique);
}

export function getDefaultRuntimeSettings() {
  return {
    primaryRuntime: DEFAULT_PRIMARY_RUNTIME,
    fallbackOrder: normalizeRuntimeOrder(env.LLM_ROUTER_FALLBACK_ORDER, ALL_RUNTIMES),
  };
}

export function extractCompanyRuntimeSettings(config: unknown) {
  const defaults = getDefaultRuntimeSettings();

  if (!config || typeof config !== 'object') {
    return defaults;
  }

  const maybeConfig = config as {
    llm_primary_runtime?: unknown;
    llm_fallback_order?: unknown;
  };

  const primaryRuntime = isRuntimeName(maybeConfig.llm_primary_runtime)
    ? maybeConfig.llm_primary_runtime
    : defaults.primaryRuntime;
  const fallbackOrder = normalizeRuntimeOrder(maybeConfig.llm_fallback_order, defaults.fallbackOrder);

  return {
    primaryRuntime,
    fallbackOrder,
  };
}
