import { describe, expect, it } from 'vitest';
import {
  getTemplatePresetById,
  listTemplatePresets,
} from '../src/services/templatePresets.js';

describe('template presets catalog', () => {
  it('lists curated presets with useful summaries', () => {
    const presets = listTemplatePresets();

    expect(presets.length).toBeGreaterThanOrEqual(3);
    expect(presets.map((preset) => preset.id)).toContain('solo-founder');
    expect(presets.every((preset) => preset.summary.agents > 0)).toBe(true);
  });

  it('returns full preset detail by id', () => {
    const preset = getTemplatePresetById('product-delivery');

    expect(preset).not.toBeNull();
    expect(preset?.template.agents.length).toBeGreaterThan(0);
    expect(preset?.template.goals.length).toBeGreaterThan(0);
  });
});
