import { env } from '../env.js';
import { logger } from '../utils/logger.js';

type RuntimeName = 'claude' | 'openai' | 'gemini';

type ModelPricing = {
  input_per_million_usd: number;
  output_per_million_usd: number;
};

type PricingOverrideMap = Record<string, ModelPricing>;

const DEFAULT_RUNTIME_PRICING: Record<RuntimeName, ModelPricing> = {
  claude: {
    input_per_million_usd: 3,
    output_per_million_usd: 15,
  },
  openai: {
    input_per_million_usd: 5,
    output_per_million_usd: 15,
  },
  gemini: {
    input_per_million_usd: 0.1,
    output_per_million_usd: 0.4,
  },
};

let cachedOverrideRaw: string | undefined;
let cachedOverrides: PricingOverrideMap | null = null;

function isValidPricing(value: unknown): value is ModelPricing {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ModelPricing>;
  return (
    typeof candidate.input_per_million_usd === 'number' &&
    Number.isFinite(candidate.input_per_million_usd) &&
    candidate.input_per_million_usd >= 0 &&
    typeof candidate.output_per_million_usd === 'number' &&
    Number.isFinite(candidate.output_per_million_usd) &&
    candidate.output_per_million_usd >= 0
  );
}

function loadPricingOverrides(): PricingOverrideMap {
  const raw = env.LLM_PRICING_OVERRIDES;
  if (!raw) {
    cachedOverrideRaw = raw;
    cachedOverrides = {};
    return cachedOverrides;
  }

  if (cachedOverrides && cachedOverrideRaw === raw) {
    return cachedOverrides;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalized = Object.entries(parsed).reduce<PricingOverrideMap>((acc, [key, value]) => {
      if (isValidPricing(value)) {
        acc[key] = value;
      }
      return acc;
    }, {});

    cachedOverrideRaw = raw;
    cachedOverrides = normalized;
    return normalized;
  } catch (err) {
    logger.warn({ err, raw }, 'Failed to parse LLM_PRICING_OVERRIDES, falling back to default runtime pricing');
    cachedOverrideRaw = raw;
    cachedOverrides = {};
    return cachedOverrides;
  }
}

function resolveModelPricing(runtime: RuntimeName, model?: string): ModelPricing {
  const overrides = loadPricingOverrides();

  if (model) {
    const exactMatch = overrides[model];
    if (exactMatch) {
      return exactMatch;
    }

    const wildcardEntry = Object.entries(overrides).find(([key]) => key.endsWith('*') && model.startsWith(key.slice(0, -1)));
    if (wildcardEntry) {
      return wildcardEntry[1];
    }
  }

  return DEFAULT_RUNTIME_PRICING[runtime];
}

export function estimateUsageCostUsd(args: {
  runtime: RuntimeName;
  model?: string;
  inputTokens: number;
  outputTokens: number;
}) {
  const pricing = resolveModelPricing(args.runtime, args.model);

  return (
    (args.inputTokens / 1_000_000) * pricing.input_per_million_usd +
    (args.outputTokens / 1_000_000) * pricing.output_per_million_usd
  );
}
