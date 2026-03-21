import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';
import { generateEmbedding, toPgVector, type EmbeddingResult } from './embeddings.js';
import {
  KnowledgeGraphService,
  mergeKnowledgeDisplayResults,
} from './knowledgeGraph.js';
import {
  recordRetrievalMetric,
  type RetrievalScope,
} from './retrievalMetrics.js';

type RetrievalDiagnostic = {
  scope: RetrievalScope;
  consumer: string;
  query: string;
  resultCount: number;
  lexicalCandidateCount: number;
  vectorCandidateCount: number;
  overlapCount: number;
  fallbackUsed: boolean;
  embeddingSource: string;
  embeddingModel: string;
  skipped?: boolean;
  reason?: string;
};

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

async function searchLexically(
  companyId: string,
  normalizedQuery: string,
  limit: number
) {
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
    termConditions.push(
      `title ILIKE $${paramIndex}`,
      `content ILIKE $${paramIndex}`
    );
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

async function searchByEmbedding(
  companyId: string,
  query: string,
  limit: number
) {
  const embedding = await generateEmbedding(query);
  try {
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
      degraded: false,
    };
  } catch (error) {
    logger.warn(
      { error, companyId, limit },
      'Vector knowledge search failed, degrading to lexical results'
    );
    return {
      rows: [],
      embedding,
      degraded: true,
      error,
    };
  }
}

async function searchLexicallySafe(
  companyId: string,
  normalizedQuery: string,
  limit: number
) {
  try {
    const result = await searchLexically(companyId, normalizedQuery, limit);
    return {
      rows: result.rows,
      degraded: false,
    };
  } catch (error) {
    logger.warn(
      { error, companyId, limit },
      'Lexical knowledge search failed, degrading to vector results'
    );
    return {
      rows: [] as any[],
      degraded: true,
      error,
    };
  }
}

function scoreKnowledgeCandidate(
  candidate: SearchCandidate,
  vectorRowCount: number
) {
  const lexicalComponent = (candidate.lexical_score ?? 0) * 100;
  const vectorComponent =
    candidate.vector_rank !== undefined
      ? Math.max(vectorRowCount - candidate.vector_rank, 0) * 10
      : 0;
  const distancePenalty = (candidate.distance ?? 1) * 5;
  const hybridBonus =
    candidate.lexical_score !== undefined && candidate.vector_rank !== undefined
      ? 25
      : 0;

  return lexicalComponent + vectorComponent + hybridBonus - distancePenalty;
}

function sanitizeTopDistance(rows: any[]) {
  const firstDistance = rows[0]?.distance;
  return typeof firstDistance === 'number'
    ? firstDistance
    : Number.isFinite(Number(firstDistance))
      ? Number(firstDistance)
      : null;
}

function resolveEmbeddingTelemetry(
  embedding?: EmbeddingResult | null
) {
  return {
    embeddingSource: embedding?.source ?? 'unavailable',
    embeddingModel: embedding?.model ?? 'unavailable',
  };
}

export function mergeKnowledgeResults(
  vectorRows: any[],
  lexicalRows: any[],
  limit: number
) {
  const candidates = new Map<string, SearchCandidate>();

  vectorRows.forEach((row, index) => {
    candidates.set(row.id, {
      id: row.id,
      title: row.title,
      content: row.content,
      metadata: row.metadata,
      created_at: row.created_at,
      vector_rank: index,
      distance:
        typeof row.distance === 'number'
          ? row.distance
          : Number(row.distance ?? 1),
    });
  });

  lexicalRows.forEach((row) => {
    const existing = candidates.get(row.id);
    const lexicalScore =
      typeof row.lexical_score === 'number'
        ? row.lexical_score
        : Number(row.lexical_score ?? 0);
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
      const leftScore = scoreKnowledgeCandidate(left, vectorRows.length);
      const rightScore = scoreKnowledgeCandidate(right, vectorRows.length);

      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }

      return (
        new Date(right.created_at).getTime() -
        new Date(left.created_at).getTime()
      );
    })
    .slice(0, limit)
    .map(({ title, content, metadata }) => ({ title, content, metadata }));
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

export const KnowledgeService = {
  async addDocument(
    companyId: string,
    title: string,
    content: string,
    metadata: any = {}
  ) {
    logger.info({ companyId, title }, 'Adding document to knowledge base');

    const embedding = await generateEmbedding(`${title}\n\n${content}`);

    const res = await db.query(
      `INSERT INTO company_knowledge (company_id, title, content, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5::vector) RETURNING id`,
      [
        companyId,
        title,
        content,
        JSON.stringify(metadata),
        toPgVector(embedding.vector),
      ]
    );

    const id = res.rows[0].id as string;

    try {
      await KnowledgeGraphService.indexDocument({
        companyId,
        documentId: id,
        title,
        content,
        metadata,
      });
    } catch (error) {
      logger.warn(
        { error, companyId, documentId: id },
        'Knowledge graph indexing failed for company document'
      );
    }

    return id;
  },

  async search(
    companyId: string,
    query: string,
    limit: number = 5,
    options: {
      agentId?: string;
      taskId?: string;
      consumer?: string;
      onDiagnostic?: (diagnostic: RetrievalDiagnostic) => void;
    } = {}
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

    const [vectorRes, lexicalRes, synapticResults] = await Promise.all([
      searchByEmbedding(companyId, normalizedQuery, safeLimit * 3),
      searchLexicallySafe(companyId, normalizedQuery, safeLimit * 3),
      KnowledgeGraphService.searchSafe(companyId, normalizedQuery, safeLimit),
    ]);
    if (vectorRes.degraded && lexicalRes.degraded) {
      throw vectorRes.error ?? lexicalRes.error ?? new Error('Knowledge search failed');
    }
    const vectorRows = vectorRes.rows;
    const lexicalRows = lexicalRes.rows;
    const lexicalIds = new Set(lexicalRes.rows.map((row) => row.id as string));
    const vectorIds = new Set(vectorRows.map((row) => row.id as string));
    const overlapCount = Array.from(vectorIds).filter((id) =>
      lexicalIds.has(id)
    ).length;
    const recordMetric = async (
      resultCount: number,
      topDistance?: number | null
    ) => {
      const embeddingTelemetry = resolveEmbeddingTelemetry(vectorRes.embedding);
      await recordRetrievalMetric({
        companyId,
        agentId: options.agentId,
        taskId: options.taskId,
        scope: 'knowledge',
        consumer: options.consumer ?? 'unknown',
        query: normalizedQuery,
        limitRequested: safeLimit,
        resultCount,
        lexicalCandidateCount: lexicalRows.length,
        vectorCandidateCount: vectorRows.length,
        overlapCount,
        topDistance,
        embeddingSource: embeddingTelemetry.embeddingSource,
        embeddingModel: embeddingTelemetry.embeddingModel,
        latencyMs: Date.now() - startedAt,
      });
    };
    const emitDiagnostic = (args: {
      resultCount: number;
      fallbackUsed: boolean;
      reason?: string;
      skipped?: boolean;
    }) => {
      const embeddingTelemetry = resolveEmbeddingTelemetry(vectorRes.embedding);
      options.onDiagnostic?.({
        scope: 'knowledge',
        consumer: options.consumer ?? 'unknown',
        query: normalizedQuery,
        resultCount: args.resultCount,
        lexicalCandidateCount: lexicalRows.length,
        vectorCandidateCount: vectorRows.length,
        overlapCount,
        fallbackUsed: args.fallbackUsed,
        embeddingSource: embeddingTelemetry.embeddingSource,
        embeddingModel: embeddingTelemetry.embeddingModel,
        skipped: args.skipped,
        reason: args.reason,
      });
    };

    if (vectorRows.length === 0 && lexicalRows.length === 0) {
      await recordMetric(0, null);
      emitDiagnostic({
        resultCount: 0,
        fallbackUsed: vectorRes.degraded || lexicalRes.degraded,
      });
      return [];
    }

    if (vectorRows.length === 0) {
      const lexicalResults = lexicalRows
        .slice(0, safeLimit)
        .map(({ title, content, metadata }) => ({ title, content, metadata }));
      const displayResults = mergeKnowledgeDisplayResults(
        lexicalResults,
        synapticResults
      );
      await recordMetric(displayResults.length, null);
      emitDiagnostic({
        resultCount: displayResults.length,
        fallbackUsed: true,
      });
      return displayResults;
    }

    const mergedResults = mergeKnowledgeResults(
      vectorRows,
      lexicalRows,
      safeLimit
    );
    const displayResults = mergeKnowledgeDisplayResults(
      mergedResults,
      synapticResults
    );
    await recordMetric(
      displayResults.length,
      sanitizeTopDistance(vectorRows)
    );
    emitDiagnostic({
      resultCount: displayResults.length,
      fallbackUsed: vectorRes.degraded || lexicalRes.degraded,
    });
    return displayResults;
  },
};
