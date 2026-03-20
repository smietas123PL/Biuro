import { Router } from 'express';
import companies from './companies.js';
import agents from './agents.js';
import tasks from './tasks.js';
import goals from './goals.js';
import messages from './messages.js';
import approvals from './approvals.js';
import tools from './tools.js';
import audit from './audit.js';
import auth from './auth.js';
import billing from './billing.js';
import templates from './templates.js';
import integrations from './integrations.js';
import knowledge from './knowledge.js';
import observability from './observability.js';
import nlCommand from './nlCommand.js';
import { requireRole } from '../middleware/auth.js';
import { requireCsrfProtection } from '../security/csrf.js';
import { env } from '../env.js';

const router: Router = Router();

router.use('/auth', auth);
router.use(requireCsrfProtection());

// Catch "undefined" in URL early
router.use((req, _res, next) => {
  if (req.path.includes('/undefined')) {
    return _res
      .status(400)
      .json({ error: 'Invalid parameter in URL: "undefined"' });
  }
  next();
});

const injectCompanyId = (req: any, res: any, next: any) => {
  if (req.params.companyId) {
    req.body = {
      ...req.body,
      company_id: req.body?.company_id ?? req.params.companyId,
    };
    req.query = {
      ...req.query,
      company_id: req.query?.company_id ?? req.params.companyId,
    };
  }
  next();
};

// === COMPANY-SCOPED ROUTES ===
// Note: /companies/:id/* sub-routes handled directly by companies router
router.use('/companies', companies);

router.use('/companies/:companyId/agents', injectCompanyId, agents);
router.use('/companies/:companyId/tasks', injectCompanyId, tasks);
router.use('/companies/:companyId/goals', injectCompanyId, goals);
router.use('/companies/:companyId/tools', injectCompanyId, tools);
router.use('/companies/:companyId/approvals', injectCompanyId, approvals);

// === GLOBAL ROUTES ===
router.use('/agents', agents);
router.use('/tasks', tasks);
router.use('/goals', goals);
router.use('/messages', messages);
router.use('/tools', tools);
router.use('/approvals', requireRole(['owner', 'admin']), approvals);
router.use('/audit', requireRole(['owner', 'admin']), audit);
router.use('/billing', billing);
router.use('/templates', templates);
router.use('/integrations', integrations);
router.use('/knowledge', requireRole(['owner', 'admin', 'member']), knowledge);
router.use('/observability', observability);
router.use('/nl-command', nlCommand);

// Health check
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: env.APP_VERSION,
    timestamp: new Date().toISOString(),
  });
});

// WS stats stub
router.get('/ws/stats', (_req, res) => {
  res.json({ totalConnections: 0, activeRooms: 0 });
});

export default router;
