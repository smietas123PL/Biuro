import { db } from '../db/client.js';
import { generateEmbedding, toPgVector } from '../services/embeddings.js';
import { recordRetrievalMetric } from '../services/retrievalMetrics.js';
import { logger } from '../utils/logger.js';

function clampLimit(limit: number) {
  return Math.max(1, Math.min(limit, 10));
}

async function searchMemoriesLexically(companyId: string, query: string, limit: number) {
  const pattern = `%${query.trim().replace(/\s+/g, '%')}%`;
  const res = await db.query(
    `SELECT content, created_at
     FROM agent_memory
     WHERE company_id = $1
       AND content ILIKE $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [companyId, pattern, limit]
  );

  return res.rows.map((row) => row.content);
}

export async function storeMemory(companyId: string, agentId: string, taskId: string, content: string) {
  try {
    const embedding = await generateEmbedding(content);

    await db.query(
      `INSERT INTO agent_memory (company_id, agent_id, task_id, content, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)`,
      [companyId, agentId, taskId, content, toPgVector(embedding.vector)]
    );

    logger.info({ agentId, taskId, source: embedding.source }, 'Stored new experience in memory');
  } catch (err: any) {
    logger.error({ err }, 'Failed to store memory');
  }
}

export async function findRelatedMemories(
  companyId: string,
  query: string,
  limit: number = 3,
  options: { agentId?: string; taskId?: string; consumer?: string } = {}
) {
  try {
    const normalizedQuery = query.trim();
    const safeLimit = clampLimit(limit);
    const startedAt = Date.now();
    if (!normalizedQuery) {
      return [];
    }

    const embedding = await generateEmbedding(normalizedQuery);
    const lexicalMatches = await searchMemoriesLexically(companyId, normalizedQuery, safeLimit);

    const res = await db.query(
      `SELECT content, metadata, (embedding <=> $1::vector) AS distance
       FROM agent_memory
       WHERE company_id = $2
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector ASC, created_at DESC
       LIMIT $3`,
      [toPgVector(embedding.vector), companyId, safeLimit]
    );
    const vectorMatches = res.rows.map((row) => row.content as string);
    const lexicalSet = new Set(lexicalMatches);
    const overlapCount = vectorMatches.filter((content) => lexicalSet.has(content)).length;

    if (res.rows.length > 0) {
      const firstDistance = res.rows[0]?.distance;
      await recordRetrievalMetric({
        companyId,
        agentId: options.agentId,
        taskId: options.taskId,
        scope: 'memory',
        consumer: options.consumer ?? 'unknown',
        query: normalizedQuery,
        limitRequested: safeLimit,
        resultCount: vectorMatches.length,
        lexicalCandidateCount: lexicalMatches.length,
        vectorCandidateCount: vectorMatches.length,
        overlapCount,
        topDistance: typeof firstDistance === 'number' ? firstDistance : Number(firstDistance ?? 0),
        embeddingSource: embedding.source,
        embeddingModel: embedding.model,
        latencyMs: Date.now() - startedAt,
      });
      return vectorMatches;
    }

    await recordRetrievalMetric({
      companyId,
      agentId: options.agentId,
      taskId: options.taskId,
      scope: 'memory',
      consumer: options.consumer ?? 'unknown',
      query: normalizedQuery,
      limitRequested: safeLimit,
      resultCount: lexicalMatches.length,
      lexicalCandidateCount: lexicalMatches.length,
      vectorCandidateCount: 0,
      overlapCount: 0,
      topDistance: null,
      embeddingSource: embedding.source,
      embeddingModel: embedding.model,
      latencyMs: Date.now() - startedAt,
    });

    return lexicalMatches;
  } catch (err: any) {
    logger.error({ err }, 'Failed to retrieve memories');
    return searchMemoriesLexically(companyId, query, clampLimit(limit));
  }
}
