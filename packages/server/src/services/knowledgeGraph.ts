import { db } from '../db/client.js';
import { generateEmbedding, toPgVector } from './embeddings.js';
import { logger } from '../utils/logger.js';

const GRAPH_STOP_WORDS = new Set([
  'about',
  'after',
  'agent',
  'agents',
  'analysis',
  'and',
  'before',
  'brief',
  'client',
  'company',
  'content',
  'customer',
  'customers',
  'dla',
  'from',
  'into',
  'jest',
  'launch',
  'need',
  'notes',
  'only',
  'oraz',
  'project',
  'result',
  'task',
  'that',
  'their',
  'this',
  'through',
  'with',
  'without',
]);

type KnowledgeNodeKind =
  | 'memory'
  | 'document'
  | 'agent'
  | 'client'
  | 'project'
  | 'topic';

type GraphDescriptor = {
  kind: 'client' | 'project' | 'topic';
  label: string;
  canonicalKey: string;
  metadata: Record<string, unknown>;
};

type SourceNodeRow = {
  id: string;
  kind: 'memory' | 'document';
  label: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string;
  lexical_score?: number;
  distance?: number | string | null;
};

type GraphRelationRow = {
  descriptor_id: string;
  descriptor_kind: 'client' | 'project' | 'topic';
  descriptor_label: string;
  descriptor_summary: string | null;
  source_id: string;
  source_kind: 'memory' | 'document';
  source_label: string;
  source_summary: string | null;
  source_metadata: Record<string, unknown> | null;
};

type SynapticKnowledgeItem = {
  title: string;
  content: string;
  metadata: Record<string, unknown>;
};

type SourceIndexInput = {
  companyId: string;
  sourceId: string;
  sourceType: 'memory' | 'document';
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  agentId?: string | null;
  taskId?: string | null;
};

function truncateText(value: string, limit: number) {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(limit - 1, 1)).trimEnd()}...`;
}

function canonicalizeLabel(label: string) {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s_-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCanonicalKey(kind: KnowledgeNodeKind, label: string) {
  return `${kind}:${canonicalizeLabel(label)}`;
}

function dedupeByKey<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function extractMetadataStringValues(
  metadata: Record<string, unknown> | undefined,
  keys: string[]
) {
  if (!metadata) {
    return [];
  }

  const values: string[] = [];
  for (const key of keys) {
    const rawValue = metadata[key];
    if (typeof rawValue === 'string' && rawValue.trim()) {
      values.push(rawValue.trim());
      continue;
    }
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        if (typeof item === 'string' && item.trim()) {
          values.push(item.trim());
        }
      }
    }
  }
  return dedupeByKey(values, (value) => canonicalizeLabel(value));
}

function extractTokens(text: string) {
  return Array.from(
    text.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu)
  )
    .map((match) => match[0])
    .filter((token) => !GRAPH_STOP_WORDS.has(token));
}

export function extractGraphDescriptors(input: {
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const descriptors: GraphDescriptor[] = [];
  const metadata = input.metadata ?? {};

  for (const label of extractMetadataStringValues(metadata, [
    'client',
    'client_name',
    'customer',
    'customer_name',
    'account',
    'account_name',
    'brand',
    'brand_name',
  ])) {
    descriptors.push({
      kind: 'client',
      label,
      canonicalKey: buildCanonicalKey('client', label),
      metadata: { inferred_from: 'metadata' },
    });
  }

  for (const label of extractMetadataStringValues(metadata, [
    'project',
    'project_name',
    'workspace',
    'workspace_name',
    'initiative',
    'campaign',
  ])) {
    descriptors.push({
      kind: 'project',
      label,
      canonicalKey: buildCanonicalKey('project', label),
      metadata: { inferred_from: 'metadata' },
    });
  }

  const cleanTitle = input.title.trim();
  if (cleanTitle && cleanTitle.split(/\s+/).length <= 8) {
    descriptors.push({
      kind: 'topic',
      label: cleanTitle,
      canonicalKey: buildCanonicalKey('topic', cleanTitle),
      metadata: { inferred_from: 'title' },
    });
  }

  const tokenCounts = new Map<string, number>();
  for (const token of extractTokens(`${input.title}\n${input.content}`)) {
    tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  }
  for (const token of Array.from(tokenCounts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, 4)
    .map(([token]) => token)) {
    descriptors.push({
      kind: 'topic',
      label: token,
      canonicalKey: buildCanonicalKey('topic', token),
      metadata: { inferred_from: 'content' },
    });
  }

  return dedupeByKey(
    descriptors.filter((descriptor) => descriptor.label.trim().length >= 3),
    (descriptor) => descriptor.canonicalKey
  );
}

async function upsertNode(input: {
  companyId: string;
  kind: KnowledgeNodeKind;
  label: string;
  canonicalKey: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  embeddingText?: string;
}) {
  const embedding = input.embeddingText
    ? await generateEmbedding(truncateText(input.embeddingText, 4_000))
    : null;

  const result = await db.query(
    `INSERT INTO knowledge_nodes (
       company_id, kind, label, canonical_key, summary, metadata, embedding
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
     ON CONFLICT (company_id, kind, canonical_key)
     DO UPDATE SET
       label = EXCLUDED.label,
       summary = CASE
         WHEN EXCLUDED.summary IS NULL OR EXCLUDED.summary = '' THEN knowledge_nodes.summary
         ELSE EXCLUDED.summary
       END,
       metadata = knowledge_nodes.metadata || EXCLUDED.metadata,
       embedding = COALESCE(EXCLUDED.embedding, knowledge_nodes.embedding),
       updated_at = now()
     RETURNING id, kind, label, summary, metadata`,
    [
      input.companyId,
      input.kind,
      input.label.trim(),
      input.canonicalKey,
      input.summary?.trim() || null,
      JSON.stringify(input.metadata ?? {}),
      embedding ? toPgVector(embedding.vector) : null,
    ]
  );

  return result.rows[0] as {
    id: string;
    kind: KnowledgeNodeKind;
    label: string;
    summary: string | null;
    metadata: Record<string, unknown> | null;
  };
}

async function upsertEdge(input: {
  companyId: string;
  fromNodeId: string;
  toNodeId: string;
  relation: 'mentions' | 'learned' | 'co_occurs';
  weight?: number;
  metadata?: Record<string, unknown>;
}) {
  await db.query(
    `INSERT INTO knowledge_edges (
       company_id, from_node_id, to_node_id, relation, weight, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (company_id, from_node_id, to_node_id, relation)
     DO UPDATE SET
       weight = GREATEST(knowledge_edges.weight, EXCLUDED.weight),
       metadata = knowledge_edges.metadata || EXCLUDED.metadata,
       updated_at = now()`,
    [
      input.companyId,
      input.fromNodeId,
      input.toNodeId,
      input.relation,
      input.weight ?? 1,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
}

async function indexSource(input: SourceIndexInput) {
  const sourceNode = await upsertNode({
    companyId: input.companyId,
    kind: input.sourceType,
    label: input.title.trim() || `${input.sourceType}:${input.sourceId}`,
    canonicalKey: `${input.sourceType}:${input.sourceId}`,
    summary: truncateText(input.content, 600),
    metadata: {
      ...input.metadata,
      source_id: input.sourceId,
      source_type: input.sourceType,
      agent_id: input.agentId ?? null,
      task_id: input.taskId ?? null,
    },
    embeddingText: `${input.title}\n\n${input.content}`,
  });

  const descriptorNodes = [];
  for (const descriptor of extractGraphDescriptors({
    title: input.title,
    content: input.content,
    metadata: input.metadata,
  })) {
    const node = await upsertNode({
      companyId: input.companyId,
      kind: descriptor.kind,
      label: descriptor.label,
      canonicalKey: descriptor.canonicalKey,
      summary: truncateText(`${descriptor.label}\n${input.content}`, 320),
      metadata: descriptor.metadata,
    });
    descriptorNodes.push(node);
    await upsertEdge({
      companyId: input.companyId,
      fromNodeId: sourceNode.id,
      toNodeId: node.id,
      relation: 'mentions',
      weight: descriptor.kind === 'topic' ? 0.75 : 1,
      metadata: { source_type: input.sourceType },
    });
  }

  if (input.agentId) {
    const agentNode = await upsertNode({
      companyId: input.companyId,
      kind: 'agent',
      label:
        typeof input.metadata?.agent_name === 'string' &&
        input.metadata.agent_name.trim()
          ? input.metadata.agent_name.trim()
          : input.agentId,
      canonicalKey: `agent:${input.agentId}`,
      metadata: { agent_id: input.agentId },
    });
    await upsertEdge({
      companyId: input.companyId,
      fromNodeId: agentNode.id,
      toNodeId: sourceNode.id,
      relation: 'learned',
      metadata: { source_type: input.sourceType },
    });
  }

  for (let index = 0; index < descriptorNodes.length; index += 1) {
    for (
      let peerIndex = index + 1;
      peerIndex < descriptorNodes.length;
      peerIndex += 1
    ) {
      await upsertEdge({
        companyId: input.companyId,
        fromNodeId: descriptorNodes[index].id,
        toNodeId: descriptorNodes[peerIndex].id,
        relation: 'co_occurs',
        weight: 0.5,
        metadata: { source_type: input.sourceType },
      });
    }
  }
}

function buildSearchTerms(query: string) {
  return query
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}_-]+/gu, '').toLowerCase())
    .filter((term) => term.length >= 2)
    .slice(0, 6);
}

async function searchSourceNodesLexically(
  companyId: string,
  normalizedQuery: string,
  limit: number
) {
  const terms = buildSearchTerms(normalizedQuery);
  const exactPattern = `%${normalizedQuery.replace(/\s+/g, '%')}%`;
  const params: Array<string | number> = [companyId, exactPattern];
  const termConditions: string[] = [];
  const scoreParts: string[] = [
    `CASE WHEN label ILIKE $2 THEN 8 ELSE 0 END`,
    `CASE WHEN summary ILIKE $2 THEN 4 ELSE 0 END`,
  ];

  for (const term of terms) {
    params.push(`%${term}%`);
    const index = params.length;
    termConditions.push(`label ILIKE $${index}`, `summary ILIKE $${index}`);
    scoreParts.push(
      `CASE WHEN label ILIKE $${index} THEN 3 ELSE 0 END`,
      `CASE WHEN summary ILIKE $${index} THEN 1 ELSE 0 END`
    );
  }

  params.push(limit);
  return db.query<SourceNodeRow>(
    `SELECT id, kind, label, summary, metadata, updated_at,
            ${scoreParts.join(' + ')} AS lexical_score
     FROM knowledge_nodes
     WHERE company_id = $1
       AND kind IN ('memory', 'document')
       AND (
         label ILIKE $2
         OR summary ILIKE $2
         ${termConditions.length ? ` OR ${termConditions.join(' OR ')}` : ''}
       )
     ORDER BY lexical_score DESC, updated_at DESC
     LIMIT $${params.length}`,
    params
  );
}

async function searchSourceNodesByEmbedding(
  companyId: string,
  normalizedQuery: string,
  limit: number
) {
  const embedding = await generateEmbedding(normalizedQuery);
  const result = await db.query<SourceNodeRow>(
    `SELECT id, kind, label, summary, metadata, updated_at,
            (embedding <=> $2::vector) AS distance
     FROM knowledge_nodes
     WHERE company_id = $1
       AND kind IN ('memory', 'document')
       AND embedding IS NOT NULL
     ORDER BY embedding <=> $2::vector ASC, updated_at DESC
     LIMIT $3`,
    [companyId, toPgVector(embedding.vector), limit]
  );
  return result.rows;
}

function mergeSourceNodeCandidates(
  vectorRows: SourceNodeRow[],
  lexicalRows: SourceNodeRow[],
  limit: number
) {
  const candidates = new Map<string, SourceNodeRow & {
    vector_rank?: number;
    lexical_rank?: number;
    distance_value?: number;
    lexical_score_value?: number;
  }>();

  vectorRows.forEach((row, index) => {
    candidates.set(row.id, {
      ...row,
      vector_rank: index,
      distance_value:
        typeof row.distance === 'number'
          ? row.distance
          : Number(row.distance ?? 1),
    });
  });

  lexicalRows.forEach((row, index) => {
    const current = candidates.get(row.id);
    candidates.set(row.id, {
      ...row,
      vector_rank: current?.vector_rank,
      distance_value: current?.distance_value,
      lexical_rank: index,
      lexical_score_value:
        typeof row.lexical_score === 'number'
          ? row.lexical_score
          : Number(row.lexical_score ?? 0),
    });
  });

  return Array.from(candidates.values())
    .sort((left, right) => {
      const leftScore =
        (left.lexical_score_value ?? 0) * 100 +
        (left.vector_rank !== undefined
          ? Math.max(vectorRows.length - left.vector_rank, 0) * 12
          : 0) -
        (left.distance_value ?? 1) * 5 +
        (left.lexical_rank !== undefined && left.vector_rank !== undefined ? 20 : 0);
      const rightScore =
        (right.lexical_score_value ?? 0) * 100 +
        (right.vector_rank !== undefined
          ? Math.max(vectorRows.length - right.vector_rank, 0) * 12
          : 0) -
        (right.distance_value ?? 1) * 5 +
        (right.lexical_rank !== undefined && right.vector_rank !== undefined ? 20 : 0);

      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    })
    .slice(0, limit);
}

async function fetchDescriptorNeighborhood(
  companyId: string,
  sourceNodeIds: string[]
) {
  if (sourceNodeIds.length === 0) {
    return [];
  }

  const result = await db.query<GraphRelationRow>(
    `SELECT
       descriptor.id AS descriptor_id,
       descriptor.kind AS descriptor_kind,
       descriptor.label AS descriptor_label,
       descriptor.summary AS descriptor_summary,
       peer.id AS source_id,
       peer.kind AS source_kind,
       peer.label AS source_label,
       peer.summary AS source_summary,
       peer.metadata AS source_metadata
     FROM knowledge_edges seed_edge
     JOIN knowledge_nodes descriptor
       ON descriptor.id = seed_edge.to_node_id
      AND descriptor.company_id = $1
      AND descriptor.kind IN ('client', 'project', 'topic')
     JOIN knowledge_edges peer_edge
       ON peer_edge.to_node_id = descriptor.id
      AND peer_edge.company_id = $1
      AND peer_edge.relation = 'mentions'
     JOIN knowledge_nodes peer
       ON peer.id = peer_edge.from_node_id
      AND peer.company_id = $1
      AND peer.kind IN ('memory', 'document')
     WHERE seed_edge.company_id = $1
       AND seed_edge.relation = 'mentions'
       AND seed_edge.from_node_id = ANY($2::uuid[])
     ORDER BY descriptor.updated_at DESC, peer.updated_at DESC`,
    [companyId, sourceNodeIds]
  );
  return result.rows;
}

function buildSynapticItems(
  sourceMatches: SourceNodeRow[],
  neighborhood: GraphRelationRow[],
  limit: number
) {
  const items: SynapticKnowledgeItem[] = [];
  const groupedByDescriptor = new Map<string, GraphRelationRow[]>();

  for (const row of neighborhood) {
    const current = groupedByDescriptor.get(row.descriptor_id) ?? [];
    current.push(row);
    groupedByDescriptor.set(row.descriptor_id, current);
  }

  for (const rows of groupedByDescriptor.values()) {
    const descriptor = rows[0];
    const relatedSources = dedupeByKey(rows, (row) => row.source_id).slice(0, 3);
    items.push({
      title: `Synaptic ${descriptor.descriptor_kind}: ${descriptor.descriptor_label}`,
      content: [
        descriptor.descriptor_summary
          ? truncateText(descriptor.descriptor_summary, 220)
          : `Shared ${descriptor.descriptor_kind} context reused across the company.`,
        ...relatedSources.map((row) => {
          const sourceAgent =
            typeof row.source_metadata?.agent_name === 'string'
              ? row.source_metadata.agent_name
              : typeof row.source_metadata?.agent_id === 'string'
                ? row.source_metadata.agent_id
                : null;
          const provenance = sourceAgent ? ` by ${sourceAgent}` : '';
          return `- ${row.source_kind}: ${row.source_label}${provenance}${row.source_summary ? ` -> ${truncateText(row.source_summary, 180)}` : ''}`;
        }),
      ].join('\n'),
      metadata: {
        source: 'knowledge_graph',
        graph_node_id: descriptor.descriptor_id,
        graph_node_kind: descriptor.descriptor_kind,
        related_sources: relatedSources.length,
      },
    });
  }

  for (const match of sourceMatches.slice(0, limit)) {
    items.push({
      title: `Synaptic ${match.kind}: ${match.label}`,
      content: truncateText(match.summary || match.label, 220),
      metadata: {
        source: 'knowledge_graph',
        graph_node_id: match.id,
        graph_node_kind: match.kind,
      },
    });
  }

  return dedupeByKey(items, (item) => `${item.title}::${item.content}`).slice(
    0,
    limit
  );
}

export function mergeKnowledgeDisplayResults(
  primaryResults: Array<{ title: string; content: string; metadata: unknown }>,
  synapticResults: SynapticKnowledgeItem[]
) {
  const merged: Array<{ title: string; content: string; metadata: unknown }> = [];
  const seen = new Set<string>();
  const limit = Math.max(primaryResults.length, Math.min(2, synapticResults.length));

  const pushUnique = (item: { title: string; content: string; metadata: unknown }) => {
    const key = `${item.title}::${item.content}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(item);
  };

  for (const item of synapticResults.slice(0, 2)) {
    pushUnique(item);
  }
  for (const item of primaryResults) {
    pushUnique(item);
  }
  for (const item of synapticResults.slice(2)) {
    pushUnique(item);
  }

  return merged.slice(0, limit);
}

export const KnowledgeGraphService = {
  async indexDocument(input: {
    companyId: string;
    documentId: string;
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
  }) {
    await indexSource({
      companyId: input.companyId,
      sourceId: input.documentId,
      sourceType: 'document',
      title: input.title,
      content: input.content,
      metadata: input.metadata,
    });
  },

  async indexMemory(input: {
    companyId: string;
    memoryId: string;
    agentId: string;
    taskId?: string | null;
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
  }) {
    await indexSource({
      companyId: input.companyId,
      sourceId: input.memoryId,
      sourceType: 'memory',
      title: input.title,
      content: input.content,
      metadata: input.metadata,
      agentId: input.agentId,
      taskId: input.taskId ?? null,
    });
  },

  async search(companyId: string, query: string, limit: number = 5) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const safeLimit = Math.max(1, Math.min(limit, 10));
    const [vectorRows, lexicalRes] = await Promise.all([
      searchSourceNodesByEmbedding(companyId, normalizedQuery, safeLimit * 2),
      searchSourceNodesLexically(companyId, normalizedQuery, safeLimit * 2),
    ]);
    const sourceMatches = mergeSourceNodeCandidates(
      vectorRows,
      lexicalRes.rows,
      safeLimit
    );
    const neighborhood = await fetchDescriptorNeighborhood(
      companyId,
      sourceMatches.map((row) => row.id)
    );
    return buildSynapticItems(sourceMatches, neighborhood, safeLimit);
  },

  async searchSafe(companyId: string, query: string, limit: number = 5) {
    try {
      return await this.search(companyId, query, limit);
    } catch (error) {
      logger.warn(
        { error, companyId, query, limit },
        'Synaptic knowledge graph search failed, continuing without graph context'
      );
      return [];
    }
  },
};
