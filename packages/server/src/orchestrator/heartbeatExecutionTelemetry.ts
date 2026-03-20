import { buildQueryPreview, type RetrievalScope } from '../services/retrievalMetrics.js';

export type HeartbeatRetrievalDiagnostic = {
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

type RetrievalAllowance =
  | { allowed: true }
  | { allowed: false; reason: 'duplicate_retrieval' | 'retrieval_budget_exhausted' };

export type HeartbeatRetrievalGuard = {
  allow: (
    scope: RetrievalScope,
    consumer: string,
    query: string
  ) => RetrievalAllowance;
};

export type HeartbeatExecutionTelemetrySnapshot = {
  retrieval_budget: {
    max_requests: number;
    consumed_requests: number;
    skipped_requests: number;
  };
  retrievals: Array<{
    scope: RetrievalScope;
    consumer: string;
    query_preview: string;
    result_count: number;
    lexical_candidate_count: number;
    vector_candidate_count: number;
    overlap_count: number;
    fallback_used: boolean;
    embedding_source: string;
    embedding_model: string;
    skipped: boolean;
    reason?: string;
  }>;
  retrieval_fallback_count: number;
  llm_fallback_count: number;
};

export function createHeartbeatExecutionTelemetry(maxRequests: number = 2) {
  const seenQueries = new Set<string>();
  const diagnostics: HeartbeatRetrievalDiagnostic[] = [];
  let consumedRequests = 0;

  const guard: HeartbeatRetrievalGuard = {
    allow(scope, consumer, query) {
      const normalizedQuery = query.trim().replace(/\s+/g, ' ').toLowerCase();
      const key = `${scope}:${consumer}:${normalizedQuery}`;

      if (seenQueries.has(key)) {
        return {
          allowed: false,
          reason: 'duplicate_retrieval',
        };
      }

      if (consumedRequests >= maxRequests) {
        return {
          allowed: false,
          reason: 'retrieval_budget_exhausted',
        };
      }

      seenQueries.add(key);
      consumedRequests += 1;
      return { allowed: true };
    },
  };

  return {
    guard,
    recordRetrieval(diagnostic: HeartbeatRetrievalDiagnostic) {
      diagnostics.push(diagnostic);
    },
    snapshot(llmFallbackCount: number = 0): HeartbeatExecutionTelemetrySnapshot {
      const retrievals = diagnostics.map((entry) => ({
        scope: entry.scope,
        consumer: entry.consumer,
        query_preview: buildQueryPreview(entry.query),
        result_count: entry.resultCount,
        lexical_candidate_count: entry.lexicalCandidateCount,
        vector_candidate_count: entry.vectorCandidateCount,
        overlap_count: entry.overlapCount,
        fallback_used: entry.fallbackUsed,
        embedding_source: entry.embeddingSource,
        embedding_model: entry.embeddingModel,
        skipped: Boolean(entry.skipped),
        ...(entry.reason ? { reason: entry.reason } : {}),
      }));

      return {
        retrieval_budget: {
          max_requests: maxRequests,
          consumed_requests: consumedRequests,
          skipped_requests: retrievals.filter((entry) => entry.skipped).length,
        },
        retrievals,
        retrieval_fallback_count: retrievals.filter(
          (entry) => entry.fallback_used
        ).length,
        llm_fallback_count: llmFallbackCount,
      };
    },
  };
}
