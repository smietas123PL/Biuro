import { Router, type Request } from 'express';
import { z } from 'zod';
import type {
  TemplateAISuggestResponse,
  TemplateAISuggestion,
} from '@biuro/shared';
import {
  CompanyTemplateSchema,
  TemplateService,
  buildTemplatePreviewAuditDetails,
} from '../services/template.js';
import { requireRole } from '../middleware/auth.js';
import {
  getTemplatePresetById,
  listTemplatePresets,
} from '../services/templatePresets.js';
import {
  getMarketplaceTemplateById,
  listMarketplaceTemplates,
} from '../services/templateMarketplace.js';
import { db } from '../db/client.js';
import type { AuthRequest } from '../utils/context.js';
import { extractCompanyRuntimeSettings } from '../runtime/preferences.js';
import { runtimeRegistry } from '../runtime/registry.js';

const router: Router = Router();

function getPresetIdParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

const aiSuggestSchema = z.object({
  prompt: z.string().min(8).max(2_000),
});

const aiSuggestionSchema = z.object({
  title: z.string().min(3).max(140),
  description: z.string().min(1).max(3_000),
  priority: z.number().int().min(0).max(100),
  default_role: z.string().min(1).max(120).nullable().default(null),
  suggested_agent_id: z.string().uuid().nullable().default(null),
  suggested_agent_name: z.string().min(1).max(120).nullable().default(null),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  warnings: z.array(z.string().min(1).max(240)).max(5).default([]),
});

type TemplateSuggestAgent = {
  id: string;
  name: string;
  role: string;
  title: string | null;
  status: string;
};

function getCompanyId(req: AuthRequest | Request) {
  const authReq = req as AuthRequest;
  return authReq.user?.companyId || req.header('x-company-id') || null;
}

function normalizeSuggestText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildHeuristicTitle(prompt: string) {
  const cleaned = prompt.trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    return 'Follow up on request';
  }

  const words = cleaned.split(' ').slice(0, 8);
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function scoreAgent(prompt: string, agent: TemplateSuggestAgent) {
  const query = normalizeSuggestText(prompt);
  const candidate = normalizeSuggestText(
    `${agent.name} ${agent.role} ${agent.title ?? ''}`
  );
  if (!query || !candidate) {
    return 0;
  }

  let score = 0;
  for (const token of query.split(' ')) {
    if (token.length < 3) {
      continue;
    }
    if (candidate.includes(token)) {
      score += token.length;
    }
  }

  return score;
}

function inferPriority(prompt: string) {
  const normalized = normalizeSuggestText(prompt);
  if (/(urgent|asap|critical|natychmiast|pilne|krytyczne)/.test(normalized)) {
    return 90;
  }
  if (
    /(today|dzis|this week|w tym tygodniu|launch|incident|pricing|konkurenc)/.test(
      normalized
    )
  ) {
    return 70;
  }
  return 50;
}

function buildHeuristicSuggestion(
  prompt: string,
  agents: TemplateSuggestAgent[]
): TemplateAISuggestion {
  const matchedAgent = agents
    .map((agent) => ({ agent, score: scoreAgent(prompt, agent) }))
    .sort((left, right) => right.score - left.score)[0];
  const selectedAgent =
    matchedAgent && matchedAgent.score > 0 ? matchedAgent.agent : null;

  return {
    title: buildHeuristicTitle(prompt),
    description: prompt.trim(),
    priority: inferPriority(prompt),
    default_role: selectedAgent?.role ?? null,
    suggested_agent_id: selectedAgent?.id ?? null,
    suggested_agent_name: selectedAgent?.name ?? null,
    confidence: selectedAgent ? 'medium' : 'low',
    warnings: ['AI suggestion used a deterministic fallback draft.'],
  };
}

function extractJsonObject(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return candidate.slice(firstBrace, lastBrace + 1);
}

async function generateAISuggestion(
  company: { name: string; mission: string | null; config?: unknown },
  agents: TemplateSuggestAgent[],
  prompt: string
): Promise<TemplateAISuggestResponse> {
  const runtimeSettings = extractCompanyRuntimeSettings(company.config);

  try {
    const runtime = runtimeRegistry.getRuntime(runtimeSettings.primaryRuntime, {
      fallbackOrder: runtimeSettings.fallbackOrder,
    });
    const response = await runtime.execute({
      company_name: company.name,
      company_mission: company.mission ?? 'No mission provided.',
      agent_name: 'Template Strategist',
      agent_role: 'AI template pre-fill assistant',
      current_task: {
        title: 'Draft a task template from a natural-language request',
        description:
          'Return one compact JSON object describing the best draft task for the request.',
      },
      goal_hierarchy: [],
      additional_context: [
        'Available agents:',
        ...agents.map(
          (agent) =>
            `- ${agent.id} | ${agent.name} | role=${agent.role} | title=${agent.title ?? 'n/a'} | status=${agent.status}`
        ),
        '',
        'Return ONLY a valid JSON object in the `thought` field with this exact shape:',
        '{"title":"string","description":"string","priority":0,"default_role":"string|null","suggested_agent_id":"uuid|null","suggested_agent_name":"string|null","confidence":"high|medium|low","warnings":["string"]}',
        'Rules:',
        '- title must be concise and action-oriented',
        '- description should be 2-4 sentences and expand the request into a clear task',
        '- priority must be an integer from 0 to 100',
        '- default_role should reflect the best owning role when possible',
        '- suggested_agent_id/name should be null if no clear assignee exists',
        '- warnings should call out ambiguity or missing context',
      ].join('\n'),
      history: [
        {
          role: 'user',
          content: `Draft a task suggestion for this request:\n${prompt.trim()}`,
        },
      ],
    });

    const rawJson = extractJsonObject(response.thought);
    if (!rawJson) {
      throw new Error('Missing JSON object in runtime response');
    }

    const parsed = aiSuggestionSchema.safeParse(JSON.parse(rawJson));
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    const validAgentIds = new Set(agents.map((agent) => agent.id));
    const normalizedSuggestion: TemplateAISuggestion = {
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority,
      default_role: parsed.data.default_role,
      suggested_agent_id:
        parsed.data.suggested_agent_id &&
        validAgentIds.has(parsed.data.suggested_agent_id)
          ? parsed.data.suggested_agent_id
          : null,
      suggested_agent_name:
        parsed.data.suggested_agent_id &&
        validAgentIds.has(parsed.data.suggested_agent_id)
          ? parsed.data.suggested_agent_name
          : null,
      confidence: parsed.data.confidence,
      warnings: parsed.data.warnings,
    };

    return {
      suggestion: normalizedSuggestion,
      planner: {
        mode: 'llm',
        runtime: response.routing?.selected_runtime,
        model: response.routing?.selected_model,
        fallback_reason: null,
      },
    };
  } catch (error) {
    return {
      suggestion: buildHeuristicSuggestion(prompt, agents),
      planner: {
        mode: 'rules',
        fallback_reason:
          error instanceof Error && /json|runtime response/i.test(error.message)
            ? 'invalid_llm_output'
            : 'llm_failed',
      },
    };
  }
}

router.get(
  '/presets',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  (_req, res) => {
    res.json(listTemplatePresets());
  }
);

router.post(
  '/ai-suggest',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req: AuthRequest, res) => {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company ID' });
    }

    const parsed = aiSuggestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    try {
      const [companyRes, agentsRes] = await Promise.all([
        db.query(
          `SELECT id, name, mission, config
         FROM companies
         WHERE id = $1`,
          [companyId]
        ),
        db.query(
          `SELECT id, name, role, title, status
         FROM agents
         WHERE company_id = $1
           AND status != 'terminated'
         ORDER BY created_at ASC`,
          [companyId]
        ),
      ]);

      if (companyRes.rows.length === 0) {
        return res.status(404).json({ error: 'Company not found' });
      }

      const result = await generateAISuggestion(
        companyRes.rows[0] as {
          name: string;
          mission: string | null;
          config?: unknown;
        },
        agentsRes.rows as TemplateSuggestAgent[],
        parsed.data.prompt
      );

      await db.query(
        `INSERT INTO audit_log (company_id, action, entity_type, details)
       VALUES ($1, 'template.ai_suggested', 'template_ai_suggestion', $2)`,
        [
          companyId,
          JSON.stringify({
            prompt: parsed.data.prompt,
            requested_by_user_id: req.user?.id ?? null,
            requested_by_role: req.user?.role ?? null,
            planner: result.planner,
            suggestion: result.suggestion,
          }),
        ]
      );

      res.json(result);
    } catch (err: any) {
      res
        .status(500)
        .json({ error: err.message || 'AI template suggestion failed' });
    }
  }
);

router.get(
  '/marketplace',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (_req, res) => {
    res.json(await listMarketplaceTemplates());
  }
);

router.get(
  '/marketplace/:id',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req, res) => {
    const marketplaceId = getPresetIdParam(req.params.id);
    if (!marketplaceId) {
      return res.status(400).json({ error: 'Invalid marketplace template ID' });
    }

    const entry = await getMarketplaceTemplateById(marketplaceId);
    if (!entry) {
      return res.status(404).json({ error: 'Marketplace template not found' });
    }

    res.json(entry);
  }
);

router.get(
  '/marketplace/:id/dry-run',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req, res) => {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company ID' });
    }

    const marketplaceId = getPresetIdParam(req.params.id);
    if (!marketplaceId) {
      return res.status(400).json({ error: 'Invalid marketplace template ID' });
    }

    const entry = await getMarketplaceTemplateById(marketplaceId);
    if (!entry) {
      return res.status(404).json({ error: 'Marketplace template not found' });
    }

    try {
      const preview = await TemplateService.previewImport(
        companyId,
        entry.template,
        {
          preserveCompanyIdentity: true,
        }
      );
      res.json({
        template: {
          id: entry.id,
          name: entry.name,
          vendor: entry.vendor,
          source_url: entry.source_url,
        },
        preview,
      });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: err.message || 'Marketplace dry run failed' });
    }
  }
);

router.post(
  '/marketplace/:id/save-preview',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req: AuthRequest, res) => {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company ID' });
    }

    const marketplaceId = getPresetIdParam(req.params.id);
    if (!marketplaceId) {
      return res.status(400).json({ error: 'Invalid marketplace template ID' });
    }

    const entry = await getMarketplaceTemplateById(marketplaceId);
    if (!entry) {
      return res.status(404).json({ error: 'Marketplace template not found' });
    }

    try {
      const preview = await TemplateService.previewImport(
        companyId,
        entry.template,
        {
          preserveCompanyIdentity: true,
        }
      );
      const details = buildTemplatePreviewAuditDetails({
        presetId: entry.id,
        presetName: entry.name,
        preview,
        userId: req.user?.id,
        role: req.user?.role,
      });

      await db.query(
        `INSERT INTO audit_log (company_id, action, entity_type, details)
       VALUES ($1, 'template.previewed', 'template_marketplace', $2)`,
        [
          companyId,
          JSON.stringify({
            ...details,
            source: 'marketplace',
            vendor: entry.vendor,
            source_url: entry.source_url,
          }),
        ]
      );

      res.status(201).json({
        saved: true,
        template: {
          id: entry.id,
          name: entry.name,
          vendor: entry.vendor,
        },
        preview,
      });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: err.message || 'Saving marketplace preview failed' });
    }
  }
);

router.get(
  '/presets/:id',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  (req, res) => {
    const presetId = getPresetIdParam(req.params.id);
    if (!presetId) {
      return res.status(400).json({ error: 'Invalid preset ID' });
    }

    const preset = getTemplatePresetById(presetId);
    if (!preset) {
      return res.status(404).json({ error: 'Preset not found' });
    }

    res.json({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      recommended_for: preset.recommended_for,
      template: preset.template,
    });
  }
);

router.get(
  '/presets/:id/dry-run',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req, res) => {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company ID' });
    }

    const presetId = getPresetIdParam(req.params.id);
    if (!presetId) {
      return res.status(400).json({ error: 'Invalid preset ID' });
    }

    const preset = getTemplatePresetById(presetId);
    if (!preset) {
      return res.status(404).json({ error: 'Preset not found' });
    }

    try {
      const preview = await TemplateService.previewImport(
        companyId,
        preset.template,
        {
          preserveCompanyIdentity: true,
        }
      );
      res.json({
        preset: {
          id: preset.id,
          name: preset.name,
        },
        preview,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Preset dry run failed' });
    }
  }
);

router.post(
  '/presets/:id/save-preview',
  requireRole(['owner', 'admin', 'member', 'viewer']),
  async (req: AuthRequest, res) => {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company ID' });
    }

    const presetId = getPresetIdParam(req.params.id);
    if (!presetId) {
      return res.status(400).json({ error: 'Invalid preset ID' });
    }

    const preset = getTemplatePresetById(presetId);
    if (!preset) {
      return res.status(404).json({ error: 'Preset not found' });
    }

    try {
      const preview = await TemplateService.previewImport(
        companyId,
        preset.template,
        {
          preserveCompanyIdentity: true,
        }
      );
      const details = buildTemplatePreviewAuditDetails({
        presetId: preset.id,
        presetName: preset.name,
        preview,
        userId: req.user?.id,
        role: req.user?.role,
      });

      await db.query(
        `INSERT INTO audit_log (company_id, action, entity_type, details)
       VALUES ($1, 'template.previewed', 'template_preset', $2)`,
        [companyId, JSON.stringify(details)]
      );

      res.status(201).json({
        saved: true,
        preset: {
          id: preset.id,
          name: preset.name,
        },
        preview,
      });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: err.message || 'Saving preset preview failed' });
    }
  }
);

// 1. Export company configuration
router.get('/export', requireRole(['owner', 'admin']), async (req, res) => {
  const companyId = getCompanyId(req);
  if (!companyId) {
    return res.status(400).json({ error: 'Missing company ID' });
  }

  try {
    const template = await TemplateService.exportCompany(companyId);
    res.json(template);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Export failed' });
  }
});

// 2. Import company configuration
router.post(
  '/import',
  requireRole(['owner', 'admin']),
  async (req: AuthRequest, res) => {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company ID' });
    }

    const parsed = CompanyTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error });
    }

    try {
      const result = await TemplateService.importCompany(
        companyId,
        parsed.data
      );
      await db.query(
        `INSERT INTO audit_log (company_id, action, entity_type, details)
       VALUES ($1, 'template.imported', 'template', $2)`,
        [
          companyId,
          JSON.stringify({
            source: 'custom',
            requested_by_user_id: req.user?.id ?? null,
            requested_by_role: req.user?.role ?? null,
            changes: result,
            template_version: parsed.data.version,
            preserve_company_identity: false,
          }),
        ]
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Import failed' });
    }
  }
);

router.post(
  '/import-preset/:id',
  requireRole(['owner', 'admin']),
  async (req: AuthRequest, res) => {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company ID' });
    }

    const presetId = getPresetIdParam(req.params.id);
    if (!presetId) {
      return res.status(400).json({ error: 'Invalid preset ID' });
    }

    const preset = getTemplatePresetById(presetId);
    if (!preset) {
      return res.status(404).json({ error: 'Preset not found' });
    }

    try {
      const result = await TemplateService.importCompany(
        companyId,
        preset.template,
        {
          preserveCompanyIdentity: true,
        }
      );
      await db.query(
        `INSERT INTO audit_log (company_id, action, entity_type, details)
       VALUES ($1, 'template.imported', 'template_preset', $2)`,
        [
          companyId,
          JSON.stringify({
            source: 'preset',
            preset_id: preset.id,
            preset_name: preset.name,
            requested_by_user_id: req.user?.id ?? null,
            requested_by_role: req.user?.role ?? null,
            preserve_company_identity: true,
            changes: result,
          }),
        ]
      );
      res.json({
        preset: {
          id: preset.id,
          name: preset.name,
        },
        result,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Preset import failed' });
    }
  }
);

router.post(
  '/import-marketplace/:id',
  requireRole(['owner', 'admin']),
  async (req: AuthRequest, res) => {
    const companyId = getCompanyId(req);
    if (!companyId) {
      return res.status(400).json({ error: 'Missing company ID' });
    }

    const marketplaceId = getPresetIdParam(req.params.id);
    if (!marketplaceId) {
      return res.status(400).json({ error: 'Invalid marketplace template ID' });
    }

    const entry = await getMarketplaceTemplateById(marketplaceId);
    if (!entry) {
      return res.status(404).json({ error: 'Marketplace template not found' });
    }

    try {
      const result = await TemplateService.importCompany(
        companyId,
        entry.template,
        {
          preserveCompanyIdentity: true,
        }
      );
      await db.query(
        `INSERT INTO audit_log (company_id, action, entity_type, details)
       VALUES ($1, 'template.imported', 'template_marketplace', $2)`,
        [
          companyId,
          JSON.stringify({
            source: 'marketplace',
            marketplace_id: entry.id,
            marketplace_name: entry.name,
            vendor: entry.vendor,
            source_url: entry.source_url,
            requested_by_user_id: req.user?.id ?? null,
            requested_by_role: req.user?.role ?? null,
            preserve_company_identity: true,
            changes: result,
          }),
        ]
      );
      res.json({
        template: {
          id: entry.id,
          name: entry.name,
          vendor: entry.vendor,
        },
        result,
      });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: err.message || 'Marketplace import failed' });
    }
  }
);

export default router;
