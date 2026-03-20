import { describe, expect, it } from 'vitest';
import { createHeartbeatExecutionTelemetry } from '../src/orchestrator/heartbeatExecutionTelemetry.js';

describe('heartbeat execution telemetry', () => {
  it('deduplicates retrievals and enforces a per-run retrieval budget', () => {
    const telemetry = createHeartbeatExecutionTelemetry(2);

    expect(
      telemetry.guard.allow('memory', 'heartbeat_memory', 'launch checklist')
    ).toEqual({ allowed: true });
    expect(
      telemetry.guard.allow('memory', 'heartbeat_memory', 'launch checklist')
    ).toEqual({
      allowed: false,
      reason: 'duplicate_retrieval',
    });
    expect(
      telemetry.guard.allow('knowledge', 'agent_context', 'launch checklist')
    ).toEqual({ allowed: true });
    expect(
      telemetry.guard.allow('knowledge', 'agent_context', 'rollout plan')
    ).toEqual({
      allowed: false,
      reason: 'retrieval_budget_exhausted',
    });

    telemetry.recordRetrieval({
      scope: 'memory',
      consumer: 'heartbeat_memory',
      query: 'launch checklist',
      resultCount: 2,
      lexicalCandidateCount: 1,
      vectorCandidateCount: 2,
      overlapCount: 1,
      fallbackUsed: true,
      embeddingSource: 'openai',
      embeddingModel: 'text-embedding-3-small',
    });
    telemetry.recordRetrieval({
      scope: 'knowledge',
      consumer: 'agent_context',
      query: 'launch checklist',
      resultCount: 0,
      lexicalCandidateCount: 0,
      vectorCandidateCount: 0,
      overlapCount: 0,
      fallbackUsed: false,
      embeddingSource: 'unavailable',
      embeddingModel: 'unavailable',
      skipped: true,
      reason: 'retrieval_budget_exhausted',
    });

    expect(telemetry.snapshot(1)).toEqual({
      retrieval_budget: {
        max_requests: 2,
        consumed_requests: 2,
        skipped_requests: 1,
      },
      retrievals: [
        {
          scope: 'memory',
          consumer: 'heartbeat_memory',
          query_preview: 'launch checklist',
          result_count: 2,
          lexical_candidate_count: 1,
          vector_candidate_count: 2,
          overlap_count: 1,
          fallback_used: true,
          embedding_source: 'openai',
          embedding_model: 'text-embedding-3-small',
          skipped: false,
        },
        {
          scope: 'knowledge',
          consumer: 'agent_context',
          query_preview: 'launch checklist',
          result_count: 0,
          lexical_candidate_count: 0,
          vector_candidate_count: 0,
          overlap_count: 0,
          fallback_used: false,
          embedding_source: 'unavailable',
          embedding_model: 'unavailable',
          skipped: true,
          reason: 'retrieval_budget_exhausted',
        },
      ],
      retrieval_fallback_count: 1,
      llm_fallback_count: 1,
    });
  });
});
