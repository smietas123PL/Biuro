import { Router } from 'express';
import { z } from 'zod';
import { KnowledgeGraphService } from '../services/knowledgeGraph.js';
import { KnowledgeService } from '../services/knowledge.js';
import { AuthRequest } from '../utils/context.js';

const router: Router = Router();
const KnowledgeDocumentSchema = z.object({
  title: z.string().trim().min(1),
  content: z.string().trim().min(1),
  metadata: z.record(z.unknown()).optional(),
});
const KnowledgeSearchSchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(25).default(5),
});
const KnowledgeGraphSearchSchema = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

router.post('/', async (req: AuthRequest, res) => {
  const parsed = KnowledgeDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }

  const { title, content, metadata } = parsed.data;
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ error: 'Company ID missing' });

  const id = await KnowledgeService.addDocument(
    companyId,
    title,
    content,
    metadata
  );
  res.json({ id });
});

router.get('/search', async (req: AuthRequest, res) => {
  const parsed = KnowledgeSearchSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }

  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ error: 'Company ID missing' });

  const results = await KnowledgeService.search(
    companyId,
    parsed.data.q,
    parsed.data.limit,
    {
      consumer: 'knowledge_api',
    }
  );
  res.json(results);
});

router.get('/graph/search', async (req: AuthRequest, res) => {
  const parsed = KnowledgeGraphSearchSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }

  const companyId = req.user?.companyId;
  if (!companyId) return res.status(400).json({ error: 'Company ID missing' });

  const results = await KnowledgeGraphService.searchSafe(
    companyId,
    parsed.data.q,
    parsed.data.limit
  );
  res.json(results);
});

export default router;
