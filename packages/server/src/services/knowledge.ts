import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

export const KnowledgeService = {
  async addDocument(companyId: string, title: string, content: string, metadata: any = {}) {
    logger.info({ companyId, title }, 'Adding document to knowledge base');
    
    // In a real app, we'd call OpenAI/Claude embeddings API here
    // const embedding = await getEmbedding(content);
    const mockEmbedding = Array(1536).fill(0).map(() => Math.random());
    
    const res = await db.query(
      `INSERT INTO company_knowledge (company_id, title, content, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [companyId, title, content, JSON.stringify(metadata), `[${mockEmbedding.join(',')}]`]
    );
    
    return res.rows[0].id;
  },

  async search(companyId: string, query: string, limit: number = 5) {
    logger.info({ companyId, query }, 'Searching company knowledge');
    
    // Simplified vector search simulation (in real SQL it would be <=> or <=>)
    const res = await db.query(
      `SELECT title, content, metadata 
       FROM company_knowledge 
       WHERE company_id = $1 
       LIMIT $2`,
      [companyId, limit]
    );
    
    return res.rows;
  }
};
