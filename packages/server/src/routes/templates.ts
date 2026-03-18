import { Router } from 'express';
import { TemplateService } from '../services/template.js';
import { requireRole } from '../middleware/auth.js';

const router: Router = Router();

// 1. Export company configuration
router.get('/export', requireRole(['owner', 'admin']), async (req, res) => {
  const companyId = req.headers['x-company-id'] as string;
  try {
    const template = await TemplateService.exportCompany(companyId);
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: 'Export failed' });
  }
});

// 2. Import company configuration
router.post('/import', requireRole(['owner', 'admin']), async (req, res) => {
  const companyId = req.headers['x-company-id'] as string;
  const template = req.body;

  if (!template || !template.company || !template.agents) {
    return res.status(400).json({ error: 'Invalid template format' });
  }

  try {
    const result = await TemplateService.importCompany(companyId, template);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Import failed' });
  }
});

export default router;
