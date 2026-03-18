import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { generateEmbedding, toPgVector } from './embeddings.js';
import { recordRetrievalMetric } from './retrievalMetrics.js';

function clampLimit(limit: number) {
  return Math.max(1, Math.min(limit, 25));
}

function buildSearchTerms(query: string) {
  return query
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}_-]+/gu, '').toLowerCase())
    .filter((term) => term.length >= 2)
    .slice(0, 6);
}

async function searchLexically(companyId: string, normalizedQuery: string, limit: number) {
  const terms = buildSearchTerms(normalizedQuery);
  const exactPattern = `%${normalizedQuery.replace(/\s+/g, '%')}%`;
  const params: any[] = [companyId, exactPattern];
  const termConditions: string[] = [];
  const scoreParts: string[] = [
    `CASE WHEN title ILIKE $2 THEN 8 ELSE 0 END`,
    `CASE WHEN content ILIKE $2 THEN 4 ELSE 0 END`,
  ];

  for (const term of terms) {
    params.push(`%${term}%`);
    const paramIndex = params.length;
    termConditions.push(`title ILIKE $${paramIndex}`, `content ILIKE $${paramIndex}`);
    scoreParts.push(
      `CASE WHEN title ILIKE $${paramIndex} THEN 3 ELSE 0 END`,
      `CASE WHEN content ILIKE $${paramIndex} THEN 1 ELSE 0 END`
    );
  }

  params.push(limit);
  const limitParam = params.length;
  const relevanceSql = scoreParts.join(' + ');
  const whereConditions = [
    'company_id = $1',
    `(title ILIKE $2 OR content ILIKE $2${termConditions.length ? ` OR ${termConditions.join(' OR ')}` : ''})`,
  ].join(' AND ');

  return db.query(
    `SELECT id, title, content, metadata, created_at, ${relevanceSql} AS lexical_score
     FROM company_knowledge
     WHERE ${whereConditions}
     ORDER BY lexical_score DESC, created_at DESC
     LIMIT $${limitParam}`,
    params
  );
}

async function searchByEmbedding(companyId: string, query: string, limit: number) {
  const embedding = await generateEmbedding(query);
  const queryResult = await db.query(
    `SELECT id, title, content, metadata, created_at, (embedding <=> $2::vector) AS distance
     FROM company_knowledge
     WHERE company_id = $1
       AND embedding IS NOT NULL
     ORDER BY embedding <=> $2::vector ASC, created_at DESC
     LIMIT $3`,
    [companyId, toPgVector(embedding.vector), limit]
  );

  return {
    rows: queryResult.rows,
    embedding,
  };
}

type SearchCandidate = {
  id: string;
  title: string;
  content: string;
  metadata: unknown;
  created_at: string;
  lexical_score?: number;
  vector_rank?: number;
  distance?: number;
};

function mergeKnowledgeResults(vectorRows: any[], lexicalRows: any[], limit: number) {
  const candidates = new Map<string, SearchCandidate>();

  vectorRows.forEach((row, index) => {
    candidates.set(row.id, {
      id: row.id,
      title: row.title,
      content: row.content,
      metadata: row.metadata,
      created_at: row.created_at,
      vector_rank: index,
      distance: typeof row.distance === 'number' ? row.distance : Number(row.distance ?? 1),
    });
  });

  lexicalRows.forEach((row) => {
    const existing = candidates.get(row.id);
    const lexicalScore = typeof row.lexical_score === 'number' ? row.lexical_score : Number(row.lexical_score ?? 0);
    candidates.set(row.id, {
      id: row.id,
      title: row.title,
      content: row.content,
      metadata: row.metadata,
      created_at: row.created_at,
      vector_rank: existing?.vector_rank,
      distance: existing?.distance,
      lexical_score: lexicalScore,
    });
  });

  return Array.from(candidates.values())
    .sort((left, right) => {
      const leftScore =
        (left.lexical_score ?? 0) * 100 +
        (left.vector_rank !== undefined ? Math.max(vectorRows.length - left.vector_rank, 0) * 10 : 0) -
        ((left.distance ?? 1) * 5);
      const rightScore =
        (right.lexical_score ?? 0) * 100 +
        (right.vector_rank !== undefined ? Math.max(vectorRows.length - right.vector_rank, 0) * 10 : 0) -
        ((right.distance ?? 1) * 5);

      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }

      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    })
    .slice(0, limit)
    .map(({ title, content, metadata }) => ({ title, content, metadata }));
}

export const KnowledgeService = {
  async addDocument(companyId: string, title: string, content: string, metadata: any = {}) {
    logger.info({ companyId, title }, 'Adding document to knowledge base');

    const embedding = await generateEmbedding(`${title}\n\n${content}`);

    const res = await db.query(
      `INSERT INTO company_knowledge (company_id, title, content, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5::vector) RETURNING id`,
      [companyId, title, content, JSON.stringify(metadata), toPgVector(embedding.vector)]
    );

    return res.rows[0].id;
  },

  async search(
    companyId: string,
    query: string,
    limit: number = 5,
    options: { agentId?: string; taskId?: string; consumer?: string } = {}
  ) {
    logger.info({ companyId, query }, 'Searching company knowledge');

    const normalizedQuery = query.trim();
    const safeLimit = clampLimit(limit);
    const startedAt = Date.now();
    if (!normalizedQuery) {
      const recentRes = await db.query(
        `SELECT title, content, metadata
         FROM company_knowledge
         WHERE company_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [companyId, safeLimit]
      );
      return recentRes.rows;
    }

    const [vectorRes, lexicalRes] = await Promise.all([
      searchByEmbedding(companyId, normalizedQuery, safeLimit * 3),
      searchLexically(companyId, normalizedQuery, safeLimit * 3),
    ]);
    const lexicalIds = new Set(lexicalRes.rows.map((row) => row.id as string));
    const vectorIds = new Set(vectorRes.rows.map((row) => row.id as string));
    const overlapCount = Array.from(vectorIds).filter((id) => lexicalIds.has(id)).length;
    const recordMetric = async (resultCount: number, topDistance?: number | null) => {
      await recordRetrievalMetric({
        companyId,
        agentId: options.agentId,
        taskId: options.taskId,
        scope: 'knowledge',
        consumer: options.consumer ?? 'unknown',
        query: normalizedQuery,
        limitRequested: safeLimit,
        resultCount,
        lexicalCandidateCount: lexicalRes.rows.length,
        vectorCandidateCount: vectorRes.rows.length,
        overlapCount,
        topDistance,
        embeddingSource: vectorRes.embedding.source,
        embeddingModel: vectorRes.embedding.model,
        latencyMs: Date.now() - startedAt,
      });
    };

    if (vectorRes.rows.length === 0 && lexicalRes.rows.length === 0) {
      await recordMetric(0, null);
      return [];
    }

    if (vectorRes.rows.length === 0) {
      const lexicalResults = lexicalRes.rows.slice(0, safeLimit).map(({ title, content, metadata }) => ({ title, content, metadata }));
      await recordMetric(lexicalResults.length, null);
      return lexicalResults;
    }

    const mergedResults = mergeKnowledgeResults(vectorRes.rows, lexicalRes.rows, safeLimit);
    const firstDistance = vectorRes.rows[0]?.distance;
    await recordMetric(
      mergedResults.length,
      typeof firstDistance === 'number' ? firstDistance : Number(firstDistance ?? 0)
    );
    return mergedResults;
  }
};
