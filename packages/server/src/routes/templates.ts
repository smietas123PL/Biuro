import { Router } from 'express';
import { CompanyTemplateSchema, TemplateService, buildTemplatePreviewAuditDetails } from '../services/template.js';
import { requireRole } from '../middleware/auth.js';
import { getTemplatePresetById, listTemplatePresets } from '../services/templatePresets.js';
import { db } from '../db/client.js';
import type { AuthRequest } from '../utils/context.js';

const router: Router = Router();

function getPresetIdParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}

router.get('/presets', requireRole(['owner', 'admin', 'member', 'viewer']), (_req, res) => {
  res.json(listTemplatePresets());
});

router.get('/presets/:id', requireRole(['owner', 'admin', 'member', 'viewer']), (req, res) => {
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
});

router.get('/presets/:id/dry-run', requireRole(['owner', 'admin', 'member', 'viewer']), async (req, res) => {
  const companyId = req.header('x-company-id');
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
    const preview = await TemplateService.previewImport(companyId, preset.template, {
      preserveCompanyIdentity: true,
    });
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
});

router.post('/presets/:id/save-preview', requireRole(['owner', 'admin', 'member', 'viewer']), async (req: AuthRequest, res) => {
  const companyId = req.header('x-company-id');
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
    const preview = await TemplateService.previewImport(companyId, preset.template, {
      preserveCompanyIdentity: true,
    });
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
    res.status(500).json({ error: err.message || 'Saving preset preview failed' });
  }
});

// 1. Export company configuration
router.get('/export', requireRole(['owner', 'admin']), async (req, res) => {
  const companyId = req.header('x-company-id');
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
router.post('/import', requireRole(['owner', 'admin']), async (req: AuthRequest, res) => {
  const companyId = req.header('x-company-id');
  if (!companyId) {
    return res.status(400).json({ error: 'Missing company ID' });
  }

  const parsed = CompanyTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }

  try {
    const result = await TemplateService.importCompany(companyId, parsed.data);
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
});

router.post('/import-preset/:id', requireRole(['owner', 'admin']), async (req: AuthRequest, res) => {
  const companyId = req.header('x-company-id');
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
    const result = await TemplateService.importCompany(companyId, preset.template, {
      preserveCompanyIdentity: true,
    });
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
});

export default router;
