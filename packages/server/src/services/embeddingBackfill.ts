import { db } from '../db/client.js';
import { generateEmbedding, toPgVector } from './embeddings.js';

type BackfillTarget = 'knowledge' | 'memory';

export type EmbeddingBackfillOptions = {
  batchSize?: number;
  onlyMissing?: boolean;
  targets?: BackfillTarget[];
};

export type EmbeddingBackfillSummary = {
  knowledge: {
    scanned: number;
    updated: number;
  };
  memory: {
    scanned: number;
    updated: number;
  };
};

function clampBatchSize(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return 25;
  }

  return Math.max(1, Math.min(Math.trunc(value), 100));
}

type KnowledgeRow = {
  id: string;
  title: string;
  content: string;
};

type MemoryRow = {
  id: string;
  content: string;
};

export function buildBackfillQueryOptions(batchSize: number, onlyMissing: boolean, offset: number) {
  if (onlyMissing) {
    return {
      clause: 'WHERE embedding IS NULL',
      params: [batchSize],
    };
  }

  return {
    clause: '',
    params: [batchSize, offset],
  };
}

async function fetchKnowledgeRows(batchSize: number, onlyMissing: boolean, offset: number) {
  const queryOptions = buildBackfillQueryOptions(batchSize, onlyMissing, offset);
  return db.query<KnowledgeRow>(
    `SELECT id, title, content
     FROM company_knowledge
     ${queryOptions.clause}
     ORDER BY created_at ASC
     LIMIT $1
     ${onlyMissing ? '' : 'OFFSET $2'}`,
    queryOptions.params
  );
}

async function fetchMemoryRows(batchSize: number, onlyMissing: boolean, offset: number) {
  const queryOptions = buildBackfillQueryOptions(batchSize, onlyMissing, offset);
  return db.query<MemoryRow>(
    `SELECT id, content
     FROM agent_memory
     ${queryOptions.clause}
     ORDER BY created_at ASC
     LIMIT $1
     ${onlyMissing ? '' : 'OFFSET $2'}`,
    queryOptions.params
  );
}

async function backfillKnowledge(batchSize: number, onlyMissing: boolean) {
  let scanned = 0;
  let updated = 0;
  let offset = 0;

  while (true) {
    const res = await fetchKnowledgeRows(batchSize, onlyMissing, offset);
    if (res.rows.length === 0) {
      break;
    }

    for (const row of res.rows) {
      const embedding = await generateEmbedding(`${row.title}\n\n${row.content}`);
      await db.query(
        'UPDATE company_knowledge SET embedding = $1::vector WHERE id = $2',
        [toPgVector(embedding.vector), row.id]
      );
      scanned += 1;
      updated += 1;
    }

    if (!onlyMissing) {
      offset += res.rows.length;
    }
  }

  return { scanned, updated };
}

async function backfillMemory(batchSize: number, onlyMissing: boolean) {
  let scanned = 0;
  let updated = 0;
  let offset = 0;

  while (true) {
    const res = await fetchMemoryRows(batchSize, onlyMissing, offset);
    if (res.rows.length === 0) {
      break;
    }

    for (const row of res.rows) {
      const embedding = await generateEmbedding(row.content);
      await db.query(
        'UPDATE agent_memory SET embedding = $1::vector WHERE id = $2',
        [toPgVector(embedding.vector), row.id]
      );
      scanned += 1;
      updated += 1;
    }

    if (!onlyMissing) {
      offset += res.rows.length;
    }
  }

  return { scanned, updated };
}

export async function runEmbeddingBackfill(options: EmbeddingBackfillOptions = {}): Promise<EmbeddingBackfillSummary> {
  const batchSize = clampBatchSize(options.batchSize);
  const onlyMissing = options.onlyMissing ?? false;
  const targets = new Set(options.targets ?? ['knowledge', 'memory']);

  const summary: EmbeddingBackfillSummary = {
    knowledge: { scanned: 0, updated: 0 },
    memory: { scanned: 0, updated: 0 },
  };

  if (targets.has('knowledge')) {
    summary.knowledge = await backfillKnowledge(batchSize, onlyMissing);
  }

  if (targets.has('memory')) {
    summary.memory = await backfillMemory(batchSize, onlyMissing);
  }

  return summary;
}
