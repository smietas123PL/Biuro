import type { CompanyTemplate } from './template.js';

export type TemplatePreset = {
  id: string;
  name: string;
  description: string;
  recommended_for: string;
  template: CompanyTemplate;
};

function summarizePreset(template: CompanyTemplate) {
  return {
    goals: template.goals.length,
    agents: template.agents.length,
    tools: template.tools.length,
    policies: template.policies.length,
  };
}

export const templatePresetsCatalog: TemplatePreset[] = [
  {
    id: 'solo-founder',
    name: 'Solo Founder Sprint',
    description: 'A lean company setup for one founder who needs planning, execution and basic operations support.',
    recommended_for: 'New product teams validating an idea with a tiny AI team.',
    template: {
      version: '1.1',
      company: {
        name: 'Solo Founder Studio',
        mission: 'Validate the first version of the product, ship quickly and keep execution visible.',
      },
      roles: ['owner', 'admin', 'member'],
      goals: [
        { ref: 'goal-1', title: 'Validate the initial offer', description: 'Find a sharp customer problem and confirm demand.', status: 'active' },
        { ref: 'goal-2', parent_ref: 'goal-1', title: 'Interview early users', description: 'Collect structured qualitative feedback every week.', status: 'active' },
        { ref: 'goal-3', parent_ref: 'goal-1', title: 'Ship a usable MVP', description: 'Release a version that supports one critical workflow.', status: 'active' },
      ],
      policies: [
        {
          name: 'Approval for external calls',
          description: 'Human review is required before tools that can affect third-party systems are executed.',
          type: 'approval_required',
          rules: { actions: ['use_tool'] },
          is_active: true,
        },
        {
          name: 'Delegation depth limit',
          description: 'Keep execution chains shallow for a small team.',
          type: 'delegation_limit',
          rules: { max_depth: 2 },
          is_active: true,
        },
      ],
      tools: [
        {
          ref: 'tool-1',
          name: 'web_search',
          description: 'Research markets, competitors and supporting material.',
          type: 'builtin',
          config: {},
        },
        {
          ref: 'tool-2',
          name: 'founder_notes',
          description: 'Shared MCP workspace for notes, plans and operating docs.',
          type: 'mcp',
          config: {
            serverName: 'founder-notes',
            command: 'node',
            args: ['dist/mock-mcp.js'],
          },
        },
      ],
      agents: [
        {
          ref: 'agent-1',
          name: 'Avery',
          role: 'chief_of_staff',
          title: 'Founder Operations Lead',
          runtime: 'claude',
          model: null,
          system_prompt: 'Keep the founder focused. Turn broad goals into a short list of visible priorities.',
          config: {},
          reports_to_ref: null,
          monthly_budget_usd: 35,
          tools: [{ tool_ref: 'tool-1', can_execute: true, config: {} }],
        },
        {
          ref: 'agent-2',
          name: 'Mika',
          role: 'product_manager',
          title: 'Product Planner',
          runtime: 'openai',
          model: null,
          system_prompt: 'Translate user signals into roadmap options and concrete backlog items.',
          config: {},
          reports_to_ref: 'agent-1',
          monthly_budget_usd: 25,
          tools: [{ tool_ref: 'tool-1', can_execute: true, config: {} }],
        },
        {
          ref: 'agent-3',
          name: 'Tess',
          role: 'operator',
          title: 'Execution Assistant',
          runtime: 'gemini',
          model: null,
          system_prompt: 'Draft docs, summaries and follow-ups so work keeps moving every day.',
          config: {},
          reports_to_ref: 'agent-1',
          monthly_budget_usd: 20,
          tools: [{ tool_ref: 'tool-2', can_execute: true, config: {} }],
        },
      ],
      budgets: [
        { agent_ref: 'agent-1', limit_usd: 35, spent_usd: 0 },
        { agent_ref: 'agent-2', limit_usd: 25, spent_usd: 0 },
        { agent_ref: 'agent-3', limit_usd: 20, spent_usd: 0 },
      ],
    },
  },
  {
    id: 'content-studio',
    name: 'Content Studio',
    description: 'A preset for a content-heavy company that needs planning, production and publishing support.',
    recommended_for: 'Agencies, media teams and founder-led brands shipping content every week.',
    template: {
      version: '1.1',
      company: {
        name: 'Content Studio',
        mission: 'Plan, produce and publish content on a repeatable weekly rhythm.',
      },
      roles: ['owner', 'admin', 'member', 'viewer'],
      goals: [
        { ref: 'goal-1', title: 'Own a focused editorial niche', description: 'Build authority in one theme and publish consistently.', status: 'active' },
        { ref: 'goal-2', parent_ref: 'goal-1', title: 'Run weekly content calendar', description: 'Maintain a rolling 4-week calendar of topics and assets.', status: 'active' },
        { ref: 'goal-3', parent_ref: 'goal-1', title: 'Repurpose each pillar piece', description: 'Turn one core asset into multiple distribution formats.', status: 'active' },
      ],
      policies: [
        {
          name: 'Tool usage review',
          description: 'Publishing-capable tools require owner or admin review.',
          type: 'approval_required',
          rules: { actions: ['use_tool'] },
          is_active: true,
        },
      ],
      tools: [
        {
          ref: 'tool-1',
          name: 'web_search',
          description: 'Collect sources, references and trend signals.',
          type: 'builtin',
          config: {},
        },
        {
          ref: 'tool-2',
          name: 'cms_api',
          description: 'HTTP connector to the publishing CMS.',
          type: 'http',
          config: {
            url: 'https://example-cms.local/api/publish',
            headers: { 'x-source': 'biuro-preset' },
          },
        },
      ],
      agents: [
        {
          ref: 'agent-1',
          name: 'Rae',
          role: 'editor_in_chief',
          title: 'Editorial Lead',
          runtime: 'claude',
          model: null,
          system_prompt: 'Own the calendar, voice and publishing quality bar.',
          config: {},
          reports_to_ref: null,
          monthly_budget_usd: 40,
          tools: [{ tool_ref: 'tool-1', can_execute: true, config: {} }],
        },
        {
          ref: 'agent-2',
          name: 'June',
          role: 'researcher',
          title: 'Trend Researcher',
          runtime: 'openai',
          model: null,
          system_prompt: 'Find useful source material, proof points and fresh angles for the editorial team.',
          config: {},
          reports_to_ref: 'agent-1',
          monthly_budget_usd: 25,
          tools: [{ tool_ref: 'tool-1', can_execute: true, config: {} }],
        },
        {
          ref: 'agent-3',
          name: 'Pax',
          role: 'publisher',
          title: 'Publishing Coordinator',
          runtime: 'gemini',
          model: null,
          system_prompt: 'Prepare publishing payloads, channel-ready versions and launch checklists.',
          config: {},
          reports_to_ref: 'agent-1',
          monthly_budget_usd: 25,
          tools: [{ tool_ref: 'tool-2', can_execute: true, config: {} }],
        },
      ],
      budgets: [
        { agent_ref: 'agent-1', limit_usd: 40, spent_usd: 0 },
        { agent_ref: 'agent-2', limit_usd: 25, spent_usd: 0 },
        { agent_ref: 'agent-3', limit_usd: 25, spent_usd: 0 },
      ],
    },
  },
  {
    id: 'product-delivery',
    name: 'Product Delivery Pod',
    description: 'A small engineering-oriented structure for shipping product work with clear ownership and review.',
    recommended_for: 'Software teams that want a compact AI delivery pod around a roadmap.',
    template: {
      version: '1.1',
      company: {
        name: 'Product Delivery Pod',
        mission: 'Move roadmap items from planning through implementation and quality review with visible governance.',
      },
      roles: ['owner', 'admin', 'member'],
      goals: [
        { ref: 'goal-1', title: 'Ship roadmap increments weekly', description: 'Maintain a healthy planning-to-delivery cadence.', status: 'active' },
        { ref: 'goal-2', parent_ref: 'goal-1', title: 'Keep execution observable', description: 'Track budgets, blockers and delivery risk daily.', status: 'active' },
        { ref: 'goal-3', parent_ref: 'goal-1', title: 'Protect quality gates', description: 'Require review for risky tool actions and deployment-adjacent work.', status: 'active' },
      ],
      policies: [
        {
          name: 'Deployment approval threshold',
          description: 'Any high-risk action should be reviewed before execution.',
          type: 'approval_required',
          rules: { actions: ['use_tool', 'delegate'] },
          is_active: true,
        },
        {
          name: 'Budget threshold review',
          description: 'Large usage spikes should be reviewed before they compound.',
          type: 'budget_threshold',
          rules: { threshold_usd: 15 },
          is_active: true,
        },
      ],
      tools: [
        {
          ref: 'tool-1',
          name: 'web_search',
          description: 'Research docs and issue context.',
          type: 'builtin',
          config: {},
        },
        {
          ref: 'tool-2',
          name: 'workspace_shell',
          description: 'Controlled shell access for repository work.',
          type: 'bash',
          config: {
            allowed_commands: ['pnpm test', 'pnpm build', 'git status'],
          },
        },
      ],
      agents: [
        {
          ref: 'agent-1',
          name: 'Iris',
          role: 'engineering_manager',
          title: 'Delivery Lead',
          runtime: 'claude',
          model: null,
          system_prompt: 'Break work into clear tasks, manage risk and keep the roadmap visible.',
          config: {},
          reports_to_ref: null,
          monthly_budget_usd: 45,
          tools: [{ tool_ref: 'tool-1', can_execute: true, config: {} }],
        },
        {
          ref: 'agent-2',
          name: 'Noel',
          role: 'software_engineer',
          title: 'Implementation Engineer',
          runtime: 'openai',
          model: null,
          system_prompt: 'Implement scoped changes and surface technical tradeoffs early.',
          config: {},
          reports_to_ref: 'agent-1',
          monthly_budget_usd: 35,
          tools: [
            { tool_ref: 'tool-1', can_execute: true, config: {} },
            { tool_ref: 'tool-2', can_execute: true, config: {} },
          ],
        },
        {
          ref: 'agent-3',
          name: 'Quinn',
          role: 'qa_lead',
          title: 'Quality Reviewer',
          runtime: 'gemini',
          model: null,
          system_prompt: 'Review execution, validate readiness and catch regressions before release.',
          config: {},
          reports_to_ref: 'agent-1',
          monthly_budget_usd: 20,
          tools: [{ tool_ref: 'tool-2', can_execute: true, config: {} }],
        },
      ],
      budgets: [
        { agent_ref: 'agent-1', limit_usd: 45, spent_usd: 0 },
        { agent_ref: 'agent-2', limit_usd: 35, spent_usd: 0 },
        { agent_ref: 'agent-3', limit_usd: 20, spent_usd: 0 },
      ],
    },
  },
];

export function listTemplatePresets() {
  return templatePresetsCatalog.map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    recommended_for: preset.recommended_for,
    summary: summarizePreset(preset.template),
  }));
}

export function getTemplatePresetById(id: string) {
  return templatePresetsCatalog.find((preset) => preset.id === id) ?? null;
}
