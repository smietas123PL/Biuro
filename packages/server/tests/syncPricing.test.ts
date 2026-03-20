import { describe, expect, it, vi } from 'vitest';
import {
  buildPricingOverrides,
  findLiteLLMModelInfo,
  isValidBiuroPricing,
  toBiuroPricing,
  upsertPricingOverridesInEnvContent,
  type LiteLLMPricing,
} from '../src/scripts/syncPricing.js';

describe('syncPricing helpers', () => {
  it('converts per-token LiteLLM pricing into positive per-million pricing', () => {
    expect(
      toBiuroPricing({
        input_cost_per_token: 0.0000025,
        output_cost_per_token: 0.00001,
      })
    ).toEqual({
      input_per_million_usd: 2.5,
      output_per_million_usd: 10,
    });
  });

  it('rejects pricing entries when input or output prices are not greater than zero', () => {
    expect(
      toBiuroPricing({
        input_cost_per_token: 0,
        output_cost_per_token: 0.00001,
      })
    ).toBeNull();
    expect(
      toBiuroPricing({
        input_cost_per_token: 0.0000025,
        output_cost_per_token: 0,
      })
    ).toBeNull();
    expect(
      isValidBiuroPricing({
        input_per_million_usd: 1,
        output_per_million_usd: 0,
      })
    ).toBe(false);
  });

  it('finds models by exact key, short name, or model_name field', () => {
    const pricing: LiteLLMPricing = {
      'anthropic/claude-3-5-sonnet-20241022': {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
      },
      alias_entry: {
        model_name: 'google/gemini-2.5-flash',
        input_cost_per_token: 0.0000003,
        output_cost_per_token: 0.0000025,
      },
    };

    expect(
      findLiteLLMModelInfo(pricing, 'anthropic/claude-3-5-sonnet-20241022')
    ).toBe(pricing['anthropic/claude-3-5-sonnet-20241022']);
    expect(findLiteLLMModelInfo(pricing, 'google/gemini-2.5-flash')).toBe(
      pricing.alias_entry
    );
  });

  it('builds overrides only from sane positive pricing and logs skipped invalid entries', () => {
    const log = vi.fn();
    const warn = vi.fn();
    const pricing: LiteLLMPricing = {
      'gpt-4o': {
        input_cost_per_token: 0.0000025,
        output_cost_per_token: 0.00001,
      },
      'gpt-4o-mini': {
        input_cost_per_token: 0.00000015,
        output_cost_per_token: 0,
      },
      'anthropic/claude-3-5-sonnet-20241022': {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
      },
    };

    const overrides = buildPricingOverrides(pricing, { log, warn });

    expect(overrides['gpt-4o']).toEqual({
      input_per_million_usd: 2.5,
      output_per_million_usd: 10,
    });
    expect(overrides['gpt-4o-mini']).toBeUndefined();
    expect(overrides['openai*']).toEqual({
      input_per_million_usd: 2.5,
      output_per_million_usd: 10,
    });
    expect(overrides['claude*']).toEqual({
      input_per_million_usd: 3,
      output_per_million_usd: 15,
    });
    expect(overrides['gemini-3.1-flash']).toEqual({
      input_per_million_usd: 0.1,
      output_per_million_usd: 0.4,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping gpt-4o-mini')
    );
  });

  it('updates or appends LLM_PRICING_OVERRIDES in env content', () => {
    const overrides = {
      'gpt-4o': {
        input_per_million_usd: 2.5,
        output_per_million_usd: 10,
      },
    };

    expect(
      upsertPricingOverridesInEnvContent(
        "OPENAI_API_KEY=test\nLLM_PRICING_OVERRIDES='{\"old\":true}'\n",
        overrides
      )
    ).toContain(
      `LLM_PRICING_OVERRIDES='${JSON.stringify(overrides)}'`
    );

    expect(
      upsertPricingOverridesInEnvContent('OPENAI_API_KEY=test', overrides)
    ).toContain(`LLM_PRICING_OVERRIDES='${JSON.stringify(overrides)}'`);
  });
});
