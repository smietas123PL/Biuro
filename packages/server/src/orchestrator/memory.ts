import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

export async function storeMemory(companyId: string, agentId: string, taskId: string, content: string) {
  try {
    // 1. Generate Embedding (Mocked for now, in prod call OpenAI/Anthropic)
    const mockEmbedding = Array(1536).fill(0).map(() => Math.random());
    
    await db.query(
      `INSERT INTO agent_memory (company_id, agent_id, task_id, content, embedding)
       VALUES ($1, $2, $3, $4, $5)`,
      [companyId, agentId, taskId, content, JSON.stringify(mockEmbedding)]
    );
    
    logger.info({ agentId, taskId }, 'Stored new experience in memory');
  } catch (err: any) {
    logger.error({ err }, 'Failed to store memory');
  }
}

export async function findRelatedMemories(companyId: string, query: string, limit: number = 3) {
  try {
    // 1. Generate Query Embedding (Mocked)
    const mockEmbedding = Array(1536).fill(0).map(() => Math.random());

    // 2. Vector Search (using cosine distance <=> operator)
    const res = await db.query(
      `SELECT content, metadata, (embedding <=> $1) as distance
       FROM agent_memory
       WHERE company_id = $2
       ORDER BY distance ASC
       LIMIT $3`,
      [JSON.stringify(mockEmbedding), companyId, limit]
    );

    return res.rows.map(row => row.content);
  } catch (err: any) {
    logger.error({ err }, 'Failed to retrieve memories');
    return [];
  }
}
