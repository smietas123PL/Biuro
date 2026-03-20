import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find workspace root (going up from packages/server/src/scripts)
const rootDir = path.resolve(__dirname, '../../../../');
const envPath = path.join(rootDir, '.env');

const PRICING_SOURCE_URL =
  'https://raw.githubusercontent.com/berriai/litellm/main/model_prices_and_context_window.json';

export interface LiteLLMPricingEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  input_cost_per_character?: number;
  output_cost_per_character?: number;
  model_name?: string;
  [key: string]: unknown;
}

export interface LiteLLMPricing {
  [model: string]: LiteLLMPricingEntry;
}

export interface BiuroPricing {
  input_per_million_usd: number;
  output_per_million_usd: number;
}

const MODELS_TO_SYNC = [
  'gpt-4o',
  'gpt-4o-mini',
  'anthropic/claude-3-5-sonnet-20241022',
  'anthropic/claude-3-5-sonnet-20240620',
  'anthropic/claude-3-5-haiku-20241022',
  'google/gemini-1.5-pro',
  'google/gemini-1.5-flash',
  'google/gemini-2.0-flash',
  'google/gemini-2.5-flash',
  'google/gemini-3.1-flash',
  'text-embedding-3-small',
] as const;

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function roundUsd(value: number) {
  return Number(value.toFixed(4));
}

export function isValidBiuroPricing(pricing: BiuroPricing) {
  return (
    isPositiveFiniteNumber(pricing.input_per_million_usd) &&
    isPositiveFiniteNumber(pricing.output_per_million_usd)
  );
}

export function toBiuroPricing(
  entry: LiteLLMPricingEntry | undefined
): BiuroPricing | null {
  if (!entry) {
    return null;
  }

  const inputPerMillion = (entry.input_cost_per_token ?? 0) * 1_000_000;
  const outputPerMillion = (entry.output_cost_per_token ?? 0) * 1_000_000;
  const pricing = {
    input_per_million_usd: roundUsd(inputPerMillion),
    output_per_million_usd: roundUsd(outputPerMillion),
  };

  return isValidBiuroPricing(pricing) ? pricing : null;
}

export function findLiteLLMModelInfo(
  data: LiteLLMPricing,
  modelId: string
): LiteLLMPricingEntry | undefined {
  const shortName = modelId.split('/').pop() || modelId;
  return (
    data[modelId] ||
    data[shortName] ||
    Object.values(data).find((entry) => entry.model_name === modelId) ||
    Object.values(data).find((entry) => entry.model_name === shortName)
  );
}

export function buildPricingOverrides(
  data: LiteLLMPricing,
  logger: Pick<Console, 'log' | 'warn'> = console
) {
  const overrides: Record<string, BiuroPricing> = {};

  for (const modelId of MODELS_TO_SYNC) {
    const info = findLiteLLMModelInfo(data, modelId);
    if (!info) {
      continue;
    }

    const pricing = toBiuroPricing(info);
    if (!pricing) {
      logger.warn(
        `[syncPricing] Skipping ${modelId} because fetched pricing is invalid. Expected both input and output prices to be > 0.`
      );
      continue;
    }

    logger.log(`Found pricing for: ${modelId}`);
    const cleanName = modelId.includes('/') ? modelId.split('/')[1] : modelId;
    overrides[cleanName] = pricing;
  }

  if (!overrides['gemini-3.1-flash']) {
    logger.log('Adding gemini-3.1-flash with estimated fallback prices');
    overrides['gemini-3.1-flash'] = {
      input_per_million_usd: 0.1,
      output_per_million_usd: 0.4,
    };
  }

  const openaiPricing = toBiuroPricing(data['gpt-4o']);
  if (openaiPricing) {
    overrides['openai*'] = openaiPricing;
  } else if (data['gpt-4o']) {
    logger.warn(
      '[syncPricing] Skipping openai* wildcard because gpt-4o pricing is invalid.'
    );
  }

  const claudePricing = toBiuroPricing(
    data['anthropic/claude-3-5-sonnet-20241022']
  );
  if (claudePricing) {
    overrides['claude*'] = claudePricing;
  } else if (data['anthropic/claude-3-5-sonnet-20241022']) {
    logger.warn(
      '[syncPricing] Skipping claude* wildcard because Claude Sonnet pricing is invalid.'
    );
  }

  return overrides;
}

export function upsertPricingOverridesInEnvContent(
  envContent: string,
  overrides: Record<string, BiuroPricing>
) {
  const jsonStr = JSON.stringify(overrides);
  const regex = /^LLM_PRICING_OVERRIDES=.*$/m;

  if (regex.test(envContent)) {
    return envContent.replace(regex, `LLM_PRICING_OVERRIDES='${jsonStr}'`);
  }

  return `${envContent}\nLLM_PRICING_OVERRIDES='${jsonStr}'\n`;
}

export async function syncPricing() {
  console.log('Fetching latest LLM pricing from LiteLLM...');

  try {
    const { data } = await axios.get<LiteLLMPricing>(PRICING_SOURCE_URL);
    const overrides = buildPricingOverrides(data);
    const jsonStr = JSON.stringify(overrides);
    console.log('Generated overrides:', jsonStr);

    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const nextEnvContent = upsertPricingOverridesInEnvContent(
        envContent,
        overrides
      );
      fs.writeFileSync(envPath, nextEnvContent);
      console.log('Updated .env file.');
    } else {
      console.warn('.env file not found at', envPath);
    }
  } catch (error) {
    console.error('Failed to sync pricing:', error);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  dotenv.config({ path: envPath });
  void syncPricing();
}
