import { describe, expect, it } from 'vitest';
import { CompanyTemplateSchema, buildTemplateImportDryRun, buildTemplatePreviewAuditDetails } from '../src/services/template.js';
import { getTemplatePresetById } from '../src/services/templatePresets.js';

describe('buildTemplateImportDryRun', () => {
  it('summarizes additive preset imports with collisions and tool updates', () => {
    const preset = getTemplatePresetById('solo-founder');
    if (!preset) {
      throw new Error('Expected preset to exist');
    }

    const summary = buildTemplateImportDryRun(
      {
        company: {
          name: 'Acme',
          mission: 'Keep the current mission',
        },
        goals: [{ title: 'Validate the initial offer' }],
        agents: [{ name: 'Avery' }],
        tools: [{ name: 'web_search' }],
        policies: [{ name: 'Approval for external calls' }],
        budgets: [{ agent_id: 'existing-agent', agent_name: 'Existing Owner' }],
      },
      preset.template,
      { preserveCompanyIdentity: true }
    );

    expect(summary.company.resulting_name).toBe('Acme');
    expect(summary.company.resulting_mission).toBe('Keep the current mission');
    expect(summary.changes).toEqual({
      goals_to_add: 3,
      agents_to_add: 3,
      policies_to_add: 2,
      budgets_to_add: 3,
      tools_to_create: 1,
      tools_to_update: 1,
      total_new_records: 12,
    });
    expect(summary.collisions).toEqual({
      agent_names: ['Avery'],
      goal_titles: ['Validate the initial offer'],
      policy_names: ['Approval for external calls'],
      tool_names: ['web_search'],
    });
    expect(summary.record_changes).toEqual({
      goals_to_add: ['Validate the initial offer', 'Interview early users', 'Ship a usable MVP'],
      agents_to_add: ['Avery', 'Mika', 'Tess'],
      policies_to_add: ['Approval for external calls', 'Delegation depth limit'],
      tools_to_create: ['founder_notes'],
      tools_to_update: ['web_search'],
      budgets_to_add: [
        { agent_name: 'Avery', limit_usd: 35, spent_usd: 0 },
        { agent_name: 'Mika', limit_usd: 25, spent_usd: 0 },
        { agent_name: 'Tess', limit_usd: 20, spent_usd: 0 },
      ],
    });
    expect(summary.projected).toEqual({
      goals: {
        count: 4,
        names: ['Validate the initial offer', 'Validate the initial offer', 'Interview early users', 'Ship a usable MVP'],
      },
      agents: {
        count: 4,
        names: ['Avery', 'Avery', 'Mika', 'Tess'],
      },
      tools: {
        count: 2,
        names: ['web_search', 'founder_notes'],
      },
      policies: {
        count: 3,
        names: ['Approval for external calls', 'Approval for external calls', 'Delegation depth limit'],
      },
      budgets: {
        count: 4,
        agent_names: ['Existing Owner', 'Avery', 'Mika', 'Tess'],
      },
    });
    expect(summary.warnings.some((warning) => warning.includes('tool name match'))).toBe(true);
    expect(summary.warnings.some((warning) => warning.includes('preserved'))).toBe(true);
  });

  it('switches resulting company identity when preserve mode is disabled', () => {
    const preset = getTemplatePresetById('content-studio');
    if (!preset) {
      throw new Error('Expected preset to exist');
    }

    const summary = buildTemplateImportDryRun(
      {
        company: {
          name: 'Current Company',
          mission: 'Current mission',
        },
        goals: [],
        agents: [],
        tools: [],
        policies: [],
        budgets: [],
      },
      preset.template
    );

    expect(summary.company.resulting_name).toBe(preset.template.company.name);
    expect(summary.company.resulting_mission).toBe(preset.template.company.mission);
    expect(summary.changes.tools_to_update).toBe(0);
    expect(summary.record_changes.tools_to_create).toEqual(['web_search', 'cms_api']);
    expect(summary.record_changes.tools_to_update).toEqual([]);
    expect(summary.projected.tools).toEqual({
      count: 2,
      names: ['web_search', 'cms_api'],
    });
    expect(summary.projected.budgets).toEqual({
      count: 3,
      agent_names: ['Rae', 'June', 'Pax'],
    });
    expect(summary.warnings.some((warning) => warning.includes('replaced'))).toBe(true);
  });

  it('builds compact audit details for a saved preview snapshot', () => {
    const preset = getTemplatePresetById('solo-founder');
    if (!preset) {
      throw new Error('Expected preset to exist');
    }

    const preview = buildTemplateImportDryRun(
      {
        company: {
          name: 'Acme',
          mission: 'Keep the current mission',
        },
        goals: [{ title: 'Validate the initial offer' }],
        agents: [{ name: 'Avery' }],
        tools: [{ name: 'web_search' }],
        policies: [{ name: 'Approval for external calls' }],
        budgets: [{ agent_id: 'existing-agent', agent_name: 'Existing Owner' }],
      },
      preset.template,
      { preserveCompanyIdentity: true }
    );

    const details = buildTemplatePreviewAuditDetails({
      presetId: preset.id,
      presetName: preset.name,
      preview,
      userId: 'user-123',
      role: 'member',
    });

    expect(details).toEqual({
      preset_id: 'solo-founder',
      preset_name: 'Solo Founder Sprint',
      requested_by_user_id: 'user-123',
      requested_by_role: 'member',
      preserve_company_identity: true,
      changes: preview.changes,
      projected_counts: {
        goals: 4,
        agents: 4,
        tools: 2,
        policies: 3,
        budgets: 4,
      },
      collision_counts: {
        agent_names: 1,
        goal_titles: 1,
        policy_names: 1,
        tool_names: 1,
      },
      sample_changes: {
        goals_to_add: ['Validate the initial offer', 'Interview early users', 'Ship a usable MVP'],
        agents_to_add: ['Avery', 'Mika', 'Tess'],
        policies_to_add: ['Approval for external calls', 'Delegation depth limit'],
        tools_to_create: ['founder_notes'],
        tools_to_update: ['web_search'],
      },
    });
  });

  it('gracefully falls back to the default runtime when importing an unknown agent runtime', () => {
    const parsed = CompanyTemplateSchema.safeParse({
      version: '1.1',
      company: {
        name: 'Future Corp',
        mission: 'Import templates across versions safely',
      },
      roles: ['owner'],
      goals: [],
      policies: [],
      tools: [],
      agents: [
        {
          ref: 'agent-1',
          name: 'Nova',
          role: 'operator',
          runtime: 'future-runtime-v2',
          monthly_budget_usd: 10,
          tools: [],
        },
      ],
      budgets: [],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error('Expected template to parse successfully');
    }

    expect(parsed.data.agents[0]?.runtime).toBe('gemini');
  });
});
