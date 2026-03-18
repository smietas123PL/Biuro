import { Router } from 'express';
import { KnowledgeService } from '../services/knowledge.js';
import { AuthRequest } from '../utils/context.js';

const router: Router = Router();

router.post('/', async (req: AuthRequest, res) => {
  const { title, content, metadata } = req.body;
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).send('Company ID missing');
  
  const id = await KnowledgeService.addDocument(companyId, title, content, metadata);
  res.send({ id });
});

router.get('/search', async (req: AuthRequest, res) => {
  const { q, limit } = req.query;
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).send('Company ID missing');
  
  const results = await KnowledgeService.search(companyId, q as string, parseInt(limit as string) || 5);
  res.send(results);
});

export default router;
