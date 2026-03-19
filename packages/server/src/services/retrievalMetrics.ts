import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

export type RetrievalScope = 'knowledge' | 'memory';

export type RetrievalMetricInput = {
  companyId: string;
  agentId?: string;
  taskId?: string;
  scope: RetrievalScope;
  consumer: string;
  query: string;
  limitRequested: number;
  resultCount: number;
  lexicalCandidateCount: number;
  vectorCandidateCount: number;
  overlapCount: number;
  topDistance?: number | null;
  embeddingSource: string;
  embeddingModel: string;
  latencyMs: number;
};

export function buildQueryPreview(query: string, maxLength: number = 160) {
  const normalized = query.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 3, 1)).trimEnd()}...`;
}

export async function recordRetrievalMetric(input: RetrievalMetricInput) {
  try {
    await db.query(
      `INSERT INTO retrieval_metrics (
         company_id,
         agent_id,
         task_id,
         scope,
         consumer,
         query_preview,
         query_length,
         limit_requested,
         result_count,
         lexical_candidate_count,
         vector_candidate_count,
         overlap_count,
         top_distance,
         embedding_source,
         embedding_model,
         latency_ms
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
       )`,
      [
        input.companyId,
        input.agentId ?? null,
        input.taskId ?? null,
        input.scope,
        input.consumer,
        buildQueryPreview(input.query),
        input.query.trim().length,
        input.limitRequested,
        input.resultCount,
        input.lexicalCandidateCount,
        input.vectorCandidateCount,
        input.overlapCount,
        input.topDistance ?? null,
        input.embeddingSource,
        input.embeddingModel,
        input.latencyMs,
      ]
    );
  } catch (err) {
    logger.warn(
      { err, scope: input.scope, consumer: input.consumer },
      'Failed to record retrieval metric'
    );
  }
}
