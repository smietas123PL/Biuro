import { db } from '../db/client.js';
import {
  generateEmbedding,
  toPgVector,
  type EmbeddingResult,
} from '../services/embeddings.js';
import { KnowledgeGraphService } from '../services/knowledgeGraph.js';
import { recordRetrievalMetric } from '../services/retrievalMetrics.js';
import { logger } from '../utils/logger.js';
import type {
  HeartbeatRetrievalDiagnostic,
  HeartbeatRetrievalGuard,
} from './heartbeatExecutionTelemetry.js';

function clampLimit(limit: number) {
  return Math.max(1, Math.min(limit, 10));
}

async function searchMemoriesLexically(
  companyId: string,
  query: string,
  limit: number
) {
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

async function searchMemoriesLexicallyDetailed(
  companyId: string,
  normalizedQuery: string,
  limit: number
) {
  const pattern = `%${normalizedQuery.replace(/\s+/g, '%')}%`;
  const res = await db.query(
    `SELECT content, created_at
     FROM agent_memory
     WHERE company_id = $1
       AND content ILIKE $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [companyId, pattern, limit]
  );

  return res.rows as Array<{ content: string; created_at: string }>;
}

async function searchMemoriesLexicallySafe(
  companyId: string,
  normalizedQuery: string,
  limit: number
) {
  try {
    return {
      rows: await searchMemoriesLexicallyDetailed(
        companyId,
        normalizedQuery,
        limit
      ),
      degraded: false,
    };
  } catch (error) {
    logger.warn(
      { error, companyId, limit },
      'Lexical memory search failed, degrading to vector results'
    );
    return {
      rows: [] as Array<{ content: string; created_at: string }>,
      degraded: true,
      error,
    };
  }
}

async function searchMemoriesByEmbeddingSafe(
  companyId: string,
  normalizedQuery: string,
  limit: number
) {
  let embedding: EmbeddingResult | null = null;
  try {
    embedding = await generateEmbedding(normalizedQuery);
    const res = await db.query(
      `SELECT content, metadata, created_at, (embedding <=> $1::vector) AS distance
       FROM agent_memory
       WHERE company_id = $2
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector ASC, created_at DESC
       LIMIT $3`,
      [toPgVector(embedding.vector), companyId, limit]
    );

    return {
      rows: res.rows as Array<{
        content: string;
        metadata?: unknown;
        created_at: string;
        distance?: number | string | null;
      }>,
      embedding,
      degraded: false,
    };
  } catch (error) {
    logger.warn(
      { error, companyId, limit },
      'Vector memory search failed, degrading to lexical results'
    );
    return {
      rows: [] as Array<{
        content: string;
        metadata?: unknown;
        created_at: string;
        distance?: number | string | null;
      }>,
      embedding,
      degraded: true,
      error,
    };
  }
}

type MemoryCandidate = {
  content: string;
  created_at: string;
  lexical_rank?: number;
  vector_rank?: number;
  distance?: number;
};

function scoreMemoryCandidate(candidate: MemoryCandidate, vectorRowCount: number) {
  const lexicalComponent =
    candidate.lexical_rank !== undefined
      ? Math.max(vectorRowCount - candidate.lexical_rank, 0) * 8
      : 0;
  const vectorComponent =
    candidate.vector_rank !== undefined
      ? Math.max(vectorRowCount - candidate.vector_rank, 0) * 10
      : 0;
  const distancePenalty = (candidate.distance ?? 1) * 5;
  const hybridBonus =
    candidate.lexical_rank !== undefined && candidate.vector_rank !== undefined
      ? 20
      : 0;

  return lexicalComponent + vectorComponent + hybridBonus - distancePenalty;
}

export function mergeMemoryResults(
  vectorRows: Array<{
    content: string;
    created_at: string;
    distance?: number | string | null;
  }>,
  lexicalRows: Array<{
    content: string;
    created_at: string;
  }>,
  limit: number
) {
  const candidates = new Map<string, MemoryCandidate>();

  vectorRows.forEach((row, index) => {
    candidates.set(row.content, {
      content: row.content,
      created_at: row.created_at,
      vector_rank: index,
      distance:
        typeof row.distance === 'number'
          ? row.distance
          : Number(row.distance ?? 1),
    });
  });

  lexicalRows.forEach((row, index) => {
    const existing = candidates.get(row.content);
    candidates.set(row.content, {
      content: row.content,
      created_at: row.created_at,
      lexical_rank: index,
      vector_rank: existing?.vector_rank,
      distance: existing?.distance,
    });
  });

  return Array.from(candidates.values())
    .sort((left, right) => {
      const leftScore = scoreMemoryCandidate(left, vectorRows.length);
      const rightScore = scoreMemoryCandidate(right, vectorRows.length);
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }

      return (
        new Date(right.created_at).getTime() -
        new Date(left.created_at).getTime()
      );
    })
    .slice(0, limit)
    .map((row) => row.content);
}

function resolveEmbeddingTelemetry(embedding?: EmbeddingResult | null) {
  return {
    embeddingSource: embedding?.source ?? 'unavailable',
    embeddingModel: embedding?.model ?? 'unavailable',
  };
}

function sanitizeTopDistance(
  rows: Array<{ distance?: number | string | null }>
) {
  const firstDistance = rows[0]?.distance;
  return typeof firstDistance === 'number'
    ? firstDistance
    : Number.isFinite(Number(firstDistance))
      ? Number(firstDistance)
      : null;
}

export async function storeMemory(
  companyId: string,
  agentId: string,
  taskId: string,
  content: string,
  metadata: Record<string, unknown> = {}
) {
  try {
    const embedding = await generateEmbedding(content);

    const insertRes = await db.query(
      `INSERT INTO agent_memory (company_id, agent_id, task_id, content, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5::vector, $6)
       RETURNING id`,
      [
        companyId,
        agentId,
        taskId,
        content,
        toPgVector(embedding.vector),
        JSON.stringify(metadata),
      ]
    );
    const memoryId = insertRes.rows[0]?.id as string | undefined;

    if (memoryId) {
      try {
        const title =
          typeof metadata.task_title === 'string' && metadata.task_title.trim()
            ? metadata.task_title.trim()
            : content.split('\n')[0]?.replace(/^Task:\s*/i, '').trim() || 'Memory';
        await KnowledgeGraphService.indexMemory({
          companyId,
          memoryId,
          agentId,
          taskId,
          title,
          content,
          metadata,
        });
      } catch (error) {
        logger.warn(
          { error, companyId, agentId, taskId, memoryId },
          'Knowledge graph indexing failed for agent memory'
        );
      }
    }

    logger.info(
      { agentId, taskId, source: embedding.source },
      'Stored new experience in memory'
    );
  } catch (err: any) {
    logger.error({ err }, 'Failed to store memory');
  }
}

export async function findRelatedMemories(
  companyId: string,
  query: string,
  limit: number = 3,
  options: {
    agentId?: string;
    taskId?: string;
    consumer?: string;
    retrievalGuard?: HeartbeatRetrievalGuard;
    onDiagnostic?: (diagnostic: HeartbeatRetrievalDiagnostic) => void;
  } = {}
) {
  try {
    const normalizedQuery = query.trim();
    const safeLimit = clampLimit(limit);
    const startedAt = Date.now();
    if (!normalizedQuery) {
      return [];
    }
    const retrievalAllowance = options.retrievalGuard?.allow(
      'memory',
      options.consumer ?? 'unknown',
      normalizedQuery
    );
    if (retrievalAllowance?.allowed === false) {
      options.onDiagnostic?.({
        scope: 'memory',
        consumer: options.consumer ?? 'unknown',
        query: normalizedQuery,
        resultCount: 0,
        lexicalCandidateCount: 0,
        vectorCandidateCount: 0,
        overlapCount: 0,
        fallbackUsed: false,
        embeddingSource: 'unavailable',
        embeddingModel: 'unavailable',
        skipped: true,
        reason: retrievalAllowance.reason,
      });
      return [];
    }

    const [vectorRes, lexicalRes] = await Promise.all([
      searchMemoriesByEmbeddingSafe(companyId, normalizedQuery, safeLimit),
      searchMemoriesLexicallySafe(companyId, normalizedQuery, safeLimit),
    ]);

    if (vectorRes.degraded && lexicalRes.degraded) {
      throw vectorRes.error ?? lexicalRes.error ?? new Error('Memory retrieval failed');
    }

    const vectorMatches = vectorRes.rows.map((row) => row.content);
    const lexicalMatches = lexicalRes.rows.map((row) => row.content);
    const lexicalSet = new Set(lexicalMatches);
    const overlapCount = vectorMatches.filter((content) =>
      lexicalSet.has(content)
    ).length;
    const embeddingTelemetry = resolveEmbeddingTelemetry(vectorRes.embedding);
    const emitDiagnostic = (args: {
      resultCount: number;
      fallbackUsed: boolean;
      reason?: string;
      skipped?: boolean;
      lexicalCandidateCount?: number;
      vectorCandidateCount?: number;
      overlapCount?: number;
      embeddingSource?: string;
      embeddingModel?: string;
    }) => {
      options.onDiagnostic?.({
        scope: 'memory',
        consumer: options.consumer ?? 'unknown',
        query: normalizedQuery,
        resultCount: args.resultCount,
        lexicalCandidateCount:
          args.lexicalCandidateCount ?? lexicalRes.rows.length,
        vectorCandidateCount:
          args.vectorCandidateCount ?? vectorRes.rows.length,
        overlapCount: args.overlapCount ?? overlapCount,
        fallbackUsed: args.fallbackUsed,
        embeddingSource:
          args.embeddingSource ?? embeddingTelemetry.embeddingSource,
        embeddingModel:
          args.embeddingModel ?? embeddingTelemetry.embeddingModel,
        skipped: args.skipped,
        reason: args.reason,
      });
    };

    if (vectorRes.rows.length > 0 && lexicalRes.rows.length > 0) {
      const merged = mergeMemoryResults(vectorRes.rows, lexicalRes.rows, safeLimit);
      await recordRetrievalMetric({
        companyId,
        agentId: options.agentId,
        taskId: options.taskId,
        scope: 'memory',
        consumer: options.consumer ?? 'unknown',
        query: normalizedQuery,
        limitRequested: safeLimit,
        resultCount: merged.length,
        lexicalCandidateCount: lexicalRes.rows.length,
        vectorCandidateCount: vectorRes.rows.length,
        overlapCount,
        topDistance: sanitizeTopDistance(vectorRes.rows),
        embeddingSource: embeddingTelemetry.embeddingSource,
        embeddingModel: embeddingTelemetry.embeddingModel,
        latencyMs: Date.now() - startedAt,
      });
      emitDiagnostic({
        resultCount: merged.length,
        fallbackUsed: vectorRes.degraded || lexicalRes.degraded,
      });
      return merged;
    }

    if (vectorRes.rows.length > 0) {
      await recordRetrievalMetric({
        companyId,
        agentId: options.agentId,
        taskId: options.taskId,
        scope: 'memory',
        consumer: options.consumer ?? 'unknown',
        query: normalizedQuery,
        limitRequested: safeLimit,
        resultCount: vectorMatches.length,
        lexicalCandidateCount: lexicalRes.rows.length,
        vectorCandidateCount: vectorRes.rows.length,
        overlapCount,
        topDistance: sanitizeTopDistance(vectorRes.rows),
        embeddingSource: embeddingTelemetry.embeddingSource,
        embeddingModel: embeddingTelemetry.embeddingModel,
        latencyMs: Date.now() - startedAt,
      });
      emitDiagnostic({
        resultCount: vectorMatches.length,
        fallbackUsed: vectorRes.degraded || lexicalRes.degraded,
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
      lexicalCandidateCount: lexicalRes.rows.length,
      vectorCandidateCount: 0,
      overlapCount: 0,
      topDistance: null,
      embeddingSource: embeddingTelemetry.embeddingSource,
      embeddingModel: embeddingTelemetry.embeddingModel,
      latencyMs: Date.now() - startedAt,
    });
    emitDiagnostic({
      resultCount: lexicalMatches.length,
      fallbackUsed: true,
    });

    return lexicalMatches;
  } catch (err: any) {
    logger.error({ err }, 'Failed to retrieve memories');
    const fallbackResults = await searchMemoriesLexically(
      companyId,
      query,
      clampLimit(limit)
    );
    options.onDiagnostic?.({
      scope: 'memory',
      consumer: options.consumer ?? 'unknown',
      query: query.trim(),
      resultCount: fallbackResults.length,
      lexicalCandidateCount: fallbackResults.length,
      vectorCandidateCount: 0,
      overlapCount: 0,
      fallbackUsed: true,
      embeddingSource: 'unavailable',
      embeddingModel: 'unavailable',
      reason: 'outer_memory_fallback',
    });
    return fallbackResults;
  }
}
