import { Router } from 'express';
import { db } from '../db/client.js';
import { TemplateService } from '../services/template.js';
import { getTemplatePresetById } from '../services/templatePresets.js';
import { logger } from '../utils/logger.js';
import type { AuthRequest } from '../utils/context.js';

const router: Router = Router();

router.get('/status', async (req: AuthRequest, res) => {
  try {
    const result = await db.query(
      `SELECT id, name FROM companies WHERE config->>'is_demo' = 'true' LIMIT 1`
    );
    res.json({
      enabled: result.rows.length > 0,
      company: result.rows[0] || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/toggle', async (req: AuthRequest, res) => {
  const { enabled } = req.body;

  try {
    if (enabled) {
      // 1. Check if demo already exists
      const existing = await db.query(
        `SELECT id FROM companies WHERE config->>'is_demo' = 'true' LIMIT 1`
      );
      if (existing.rows.length > 0) {
        return res.json({ success: true, companyId: existing.rows[0].id });
      }

      // 2. Import preset
      const preset = getTemplatePresetById('content-flow-demo');
      if (!preset) {
        throw new Error('Demo preset not found');
      }

      // We create a new company for the demo
      const companyRes = await db.query(
        `INSERT INTO companies (name, mission, config) 
         VALUES ($1, $2, $3) 
         RETURNING id`,
        [
          preset.template.company.name,
          preset.template.company.mission,
          JSON.stringify(preset.template.company.config),
        ]
      );
      const companyId = companyRes.rows[0].id;

      await TemplateService.importCompany(companyId, preset.template, {
        preserveCompanyIdentity: true,
      });

      // 3. Create initial task
      await db.query(
        `INSERT INTO tasks (company_id, title, description, priority, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          companyId,
          'Prepare technical article: Impact of AI on Software Engineering in 2026',
          'Conduct research on latest trends, create an outline, and write a high-quality article for the blog.',
          90,
          'backlog',
        ]
      );

      logger.info({ companyId }, 'Demo scenario launched');
      res.json({ success: true, companyId });
    } else {
      // Disable demo: find and delete all demo companies
      const demoCompanies = await db.query(
        `SELECT id FROM companies WHERE config->>'is_demo' = 'true'`
      );
      
      for (const row of demoCompanies.rows) {
        await db.query(`DELETE FROM companies WHERE id = $1`, [row.id]);
        logger.info({ companyId: row.id }, 'Demo scenario stopped and cleaned up');
      }

      res.json({ success: true });
    }
  } catch (err: any) {
    logger.error({ err }, 'Failed to toggle demo');
    res.status(500).json({ error: err.message });
  }
});

export default router;
