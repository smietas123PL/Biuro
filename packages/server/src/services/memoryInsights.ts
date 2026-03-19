import { db } from '../db/client.js';

type MemorySummaryRow = {
  total_memories: number | string;
  recent_memories: number | string;
  agents_with_memories: number | string;
  tasks_with_memories: number | string;
  memory_reuse_searches: number | string;
};

type TopAgentRow = {
  agent_id: string;
  agent_name: string | null;
  total_memories: number | string;
  latest_memory_at: string;
};

type RecentLessonRow = {
  id: string;
  content: string;
  created_at: string;
  agent_id: string;
  agent_name: string | null;
  task_id: string | null;
  task_title: string | null;
};

type RevisitedQueryRow = {
  query: string | null;
  total: number | string;
};

const MEMORY_STOP_WORDS = new Set([
  'about',
  'after',
  'agent',
  'agents',
  'also',
  'analiza',
  'and',
  'bez',
  'before',
  'between',
  'brak',
  'can',
  'czy',
  'dla',
  'done',
  'during',
  'from',
  'have',
  'into',
  'jest',
  'juz',
  'just',
  'kiedy',
  'more',
  'most',
  'nalezy',
  'need',
  'next',
  'nie',
  'once',
  'only',
  'oraz',
  'over',
  'podczas',
  'poza',
  'przed',
  'przez',
  'should',
  'task',
  'tasks',
  'that',
  'the',
  'their',
  'there',
  'these',
  'this',
  'those',
  'through',
  'today',
  'very',
  'while',
  'with',
  'without',
  'wiecej',
  'work',
  'zeby',
  'znowu',
]);

function toNumber(value: string | number | null | undefined) {
  if (typeof value === 'number') {
    return value;
  }

  return Number(value ?? 0);
}

function extractTokens(content: string) {
  return Array.from(content.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu))
    .map((match) => match[0])
    .filter((token) => !MEMORY_STOP_WORDS.has(token));
}

function buildRecurringTopics(items: RecentLessonRow[]) {
  const phraseCounts = new Map<string, number>();
  const keywordCounts = new Map<string, number>();

  for (const item of items) {
    const tokens = extractTokens(item.content);
    const uniqueKeywords = new Set(tokens);
    const uniquePhrases = new Set<string>();

    for (let index = 0; index < tokens.length - 1; index += 1) {
      uniquePhrases.add(`${tokens[index]} ${tokens[index + 1]}`);
    }

    for (const keyword of uniqueKeywords) {
      keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1);
    }

    for (const phrase of uniquePhrases) {
      phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
    }
  }

  const phraseTopics = Array.from(phraseCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    })
    .map(([label, count]) => ({ label, count }));

  const seen = new Set(phraseTopics.map((item) => item.label));
  const keywordTopics = Array.from(keywordCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    })
    .map(([label, count]) => ({ label, count }))
    .filter((item) => !seen.has(item.label));

  return [...phraseTopics, ...keywordTopics].slice(0, 6);
}

export async function getMemoryInsights(companyId: string, days: number) {
  const [summaryRes, topAgentsRes, recentLessonsRes, revisitedQueriesRes] = await Promise.all([
    db.query<MemorySummaryRow>(
      `SELECT
         (SELECT COUNT(*) FROM agent_memory WHERE company_id = $1)::int AS total_memories,
         COUNT(*)::int AS recent_memories,
         COUNT(DISTINCT agent_id)::int AS agents_with_memories,
         COUNT(DISTINCT task_id)::int AS tasks_with_memories,
         (
           SELECT COUNT(*)
           FROM retrieval_metrics
           WHERE company_id = $1
             AND scope = 'memory'
             AND created_at >= now() - make_interval(days => $2)
         )::int AS memory_reuse_searches
       FROM agent_memory
       WHERE company_id = $1
         AND created_at >= now() - make_interval(days => $2)`,
      [companyId, days]
    ),
    db.query<TopAgentRow>(
      `SELECT
         m.agent_id,
         a.name AS agent_name,
         COUNT(*)::int AS total_memories,
         MAX(m.created_at) AS latest_memory_at
       FROM agent_memory m
       JOIN agents a ON a.id = m.agent_id
       WHERE m.company_id = $1
         AND m.created_at >= now() - make_interval(days => $2)
       GROUP BY m.agent_id, a.name
       ORDER BY total_memories DESC, latest_memory_at DESC
       LIMIT 5`,
      [companyId, days]
    ),
    db.query<RecentLessonRow>(
      `SELECT
         m.id,
         m.content,
         m.created_at,
         m.agent_id,
         a.name AS agent_name,
         m.task_id,
         t.title AS task_title
       FROM agent_memory m
       JOIN agents a ON a.id = m.agent_id
       LEFT JOIN tasks t ON t.id = m.task_id
       WHERE m.company_id = $1
         AND m.created_at >= now() - make_interval(days => $2)
       ORDER BY m.created_at DESC
       LIMIT 24`,
      [companyId, days]
    ),
    db.query<RevisitedQueryRow>(
      `SELECT
         query,
         COUNT(*)::int AS total
       FROM retrieval_metrics
       WHERE company_id = $1
         AND scope = 'memory'
         AND created_at >= now() - make_interval(days => $2)
         AND query IS NOT NULL
         AND length(trim(query)) > 0
       GROUP BY query
       ORDER BY total DESC, query ASC
       LIMIT 5`,
      [companyId, days]
    ),
  ]);

  const summary = summaryRes.rows[0] ?? {
    total_memories: 0,
    recent_memories: 0,
    agents_with_memories: 0,
    tasks_with_memories: 0,
    memory_reuse_searches: 0,
  };
  const recentLessons = recentLessonsRes.rows;

  return {
    range_days: days,
    summary: {
      total_memories: toNumber(summary.total_memories),
      recent_memories: toNumber(summary.recent_memories),
      agents_with_memories: toNumber(summary.agents_with_memories),
      tasks_with_memories: toNumber(summary.tasks_with_memories),
      memory_reuse_searches: toNumber(summary.memory_reuse_searches),
    },
    recurring_topics: buildRecurringTopics(recentLessons),
    top_agents: topAgentsRes.rows.map((row) => ({
      agent_id: row.agent_id,
      agent_name: row.agent_name ?? 'Unknown agent',
      total_memories: toNumber(row.total_memories),
      latest_memory_at: row.latest_memory_at,
    })),
    revisited_queries: revisitedQueriesRes.rows.map((row) => ({
      query: row.query ?? '',
      total: toNumber(row.total),
    })),
    recent_lessons: recentLessons.map((row) => ({
      id: row.id,
      content: row.content,
      created_at: row.created_at,
      agent_id: row.agent_id,
      agent_name: row.agent_name ?? 'Unknown agent',
      task_id: row.task_id,
      task_title: row.task_title,
    })),
  };
}
