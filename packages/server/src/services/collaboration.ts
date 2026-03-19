import { db } from '../db/client.js';
import { broadcastCompanyEvent } from '../realtime/eventBus.js';

type CollaborationTaskRow = {
  id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
  assigned_to_role: string | null;
  assigned_to_status: string | null;
  priority: number;
  depth: number;
  created_at: string;
  updated_at: string;
};

type CollaborationMessageRow = {
  id: string;
  task_id: string;
  task_title: string;
  from_agent: string | null;
  from_agent_name: string | null;
  from_agent_role: string | null;
  to_agent: string | null;
  to_agent_name: string | null;
  to_agent_role: string | null;
  content: string;
  type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type CollaborationHeartbeatRow = {
  id: string;
  task_id: string;
  task_title: string;
  agent_id: string;
  agent_name: string;
  agent_role: string;
  status: string;
  duration_ms: number | null;
  cost_usd: string | number | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export type CollaborationTimelineItem = {
  id: string;
  kind: 'thought' | 'message' | 'delegation' | 'status' | 'tool' | 'supervisor';
  task_id: string;
  task_title: string;
  agent_id: string | null;
  agent_name: string;
  agent_role: string | null;
  to_agent_id: string | null;
  to_agent_name: string | null;
  to_agent_role: string | null;
  content: string;
  summary: string;
  message_type: string | null;
  duration_ms: number | null;
  cost_usd: string | number | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

export type CollaborationSnapshot = {
  generated_at: string;
  root_task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
  };
  current_task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
  };
  tasks: Array<{
    id: string;
    parent_id: string | null;
    title: string;
    description: string | null;
    status: string;
    assigned_to: string | null;
    assigned_to_name: string | null;
    assigned_to_role: string | null;
    assigned_to_status: string | null;
    priority: number;
    depth: number;
    created_at: string;
    updated_at: string;
  }>;
  participants: Array<{
    agent_id: string;
    name: string;
    role: string | null;
    status: string | null;
    assigned_task_count: number;
    contribution_count: number;
    latest_activity_at: string | null;
  }>;
  timeline: CollaborationTimelineItem[];
  summary: {
    task_count: number;
    participant_count: number;
    thought_count: number;
    message_count: number;
    delegation_count: number;
  };
};

function normalizeText(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function summarizeMessageRow(row: CollaborationMessageRow) {
  const sender = row.from_agent_name ?? 'Supervisor';
  const recipient = row.to_agent_name ?? row.to_agent_role ?? 'the task force';

  if (row.type === 'delegation') {
    return `${sender} delegated work to ${recipient}.`;
  }

  if (row.type === 'status_update') {
    return `${sender} shared a live status update.`;
  }

  if (row.type === 'tool_result') {
    return `${sender} posted a tool result.`;
  }

  if (!row.from_agent) {
    return `Supervisor directed ${recipient}.`;
  }

  return `${sender} sent a message to ${recipient}.`;
}

function mapMessageKind(type: string, fromAgent: string | null): CollaborationTimelineItem['kind'] {
  if (!fromAgent) {
    return 'supervisor';
  }

  if (type === 'delegation') {
    return 'delegation';
  }

  if (type === 'status_update' || type === 'approval_request') {
    return 'status';
  }

  if (type === 'tool_result' || type === 'tool_call') {
    return 'tool';
  }

  return 'message';
}

function extractHeartbeatThought(details: Record<string, unknown> | null) {
  return normalizeText(details?.thought, '');
}

export async function getRootTaskId(taskId: string) {
  const rootRes = await db.query(
    `WITH RECURSIVE lineage AS (
       SELECT id, parent_id
       FROM tasks
       WHERE id = $1
       UNION ALL
       SELECT t.id, t.parent_id
       FROM tasks t
       JOIN lineage l ON l.parent_id = t.id
     )
     SELECT id
     FROM lineage
     WHERE parent_id IS NULL
     LIMIT 1`,
    [taskId]
  );

  return (rootRes.rows[0]?.id as string | undefined) ?? null;
}

export async function findDelegateAgent(companyId: string, role: string, excludeAgentId?: string) {
  const trimmedRole = role.trim();
  if (!trimmedRole) {
    return null;
  }

  const res = await db.query(
    `SELECT id, name, role, status
     FROM agents
     WHERE company_id = $1
       AND status IN ('idle', 'working')
       AND ($2::uuid IS NULL OR id <> $2)
       AND (
         LOWER(role) = LOWER($3)
         OR LOWER(COALESCE(title, '')) = LOWER($3)
       )
     ORDER BY
       CASE WHEN status = 'idle' THEN 0 ELSE 1 END,
       updated_at ASC,
       created_at ASC
     LIMIT 1`,
    [companyId, excludeAgentId ?? null, trimmedRole]
  );

  return res.rows[0] ?? null;
}

export async function broadcastCollaborationSignal(
  companyId: string,
  taskId: string,
  kind: string,
  details: Record<string, unknown> = {}
) {
  const rootTaskId = (await getRootTaskId(taskId)) ?? taskId;
  await broadcastCompanyEvent(companyId, 'task.collaboration', {
    root_task_id: rootTaskId,
    task_id: taskId,
    kind,
    ...details,
  }, 'worker');
}

export async function getTaskCollaborationSnapshot(taskId: string): Promise<CollaborationSnapshot | null> {
  const rootTaskId = await getRootTaskId(taskId);
  if (!rootTaskId) {
    return null;
  }

  const taskTreeRes = await db.query(
    `WITH RECURSIVE task_tree AS (
       SELECT
         t.id,
         t.parent_id,
         t.title,
         t.description,
         t.status,
         t.assigned_to,
         t.priority,
         t.created_at,
         t.updated_at,
         0 AS depth
       FROM tasks t
       WHERE t.id = $1
       UNION ALL
       SELECT
         child.id,
         child.parent_id,
         child.title,
         child.description,
         child.status,
         child.assigned_to,
         child.priority,
         child.created_at,
         child.updated_at,
         tree.depth + 1 AS depth
       FROM tasks child
       JOIN task_tree tree ON child.parent_id = tree.id
     )
     SELECT
       tree.*,
       assigned.name AS assigned_to_name,
       assigned.role AS assigned_to_role,
       assigned.status AS assigned_to_status
     FROM task_tree tree
     LEFT JOIN agents assigned ON assigned.id = tree.assigned_to
     ORDER BY tree.depth ASC, tree.created_at ASC`,
    [rootTaskId]
  );

  if (taskTreeRes.rows.length === 0) {
    return null;
  }

  const tasks = taskTreeRes.rows as CollaborationTaskRow[];
  const currentTask = tasks.find((entry) => entry.id === taskId) ?? tasks[0];
  const rootTask = tasks[0];
  const taskIds = tasks.map((entry) => entry.id);

  const [messagesRes, heartbeatsRes] = await Promise.all([
    db.query(
      `SELECT
         m.id,
         m.task_id,
         t.title AS task_title,
         m.from_agent,
         sender.name AS from_agent_name,
         sender.role AS from_agent_role,
         m.to_agent,
         recipient.name AS to_agent_name,
         recipient.role AS to_agent_role,
         m.content,
         m.type,
         m.metadata,
         m.created_at
       FROM messages m
       JOIN tasks t ON t.id = m.task_id
       LEFT JOIN agents sender ON sender.id = m.from_agent
       LEFT JOIN agents recipient ON recipient.id = m.to_agent
       WHERE m.task_id = ANY($1::uuid[])
       ORDER BY m.created_at ASC`,
      [taskIds]
    ),
    db.query(
      `SELECT
         h.id,
         h.task_id,
         t.title AS task_title,
         h.agent_id,
         a.name AS agent_name,
         a.role AS agent_role,
         h.status,
         h.duration_ms,
         h.cost_usd,
         h.details,
         h.created_at
       FROM heartbeats h
       JOIN tasks t ON t.id = h.task_id
       JOIN agents a ON a.id = h.agent_id
       WHERE h.task_id = ANY($1::uuid[])
         AND COALESCE(NULLIF(h.details->>'thought', ''), '') <> ''
       ORDER BY h.created_at ASC`,
      [taskIds]
    ),
  ]);

  const timeline: CollaborationTimelineItem[] = [];
  const participantMap = new Map<
    string,
    {
      agent_id: string;
      name: string;
      role: string | null;
      status: string | null;
      assigned_task_count: number;
      contribution_count: number;
      latest_activity_at: string | null;
    }
  >();

  for (const task of tasks) {
    if (!task.assigned_to || !task.assigned_to_name) {
      continue;
    }

    const existing = participantMap.get(task.assigned_to) ?? {
      agent_id: task.assigned_to,
      name: task.assigned_to_name,
      role: task.assigned_to_role,
      status: task.assigned_to_status,
      assigned_task_count: 0,
      contribution_count: 0,
      latest_activity_at: null,
    };
    existing.assigned_task_count += 1;
    participantMap.set(task.assigned_to, existing);
  }

  for (const row of messagesRes.rows as CollaborationMessageRow[]) {
    const item: CollaborationTimelineItem = {
      id: row.id,
      kind: mapMessageKind(row.type, row.from_agent),
      task_id: row.task_id,
      task_title: row.task_title,
      agent_id: row.from_agent,
      agent_name: row.from_agent_name ?? 'Supervisor',
      agent_role: row.from_agent_role ?? null,
      to_agent_id: row.to_agent,
      to_agent_name: row.to_agent_name,
      to_agent_role: row.to_agent_role,
      content: row.content,
      summary: summarizeMessageRow(row),
      message_type: row.type,
      duration_ms: null,
      cost_usd: null,
      created_at: row.created_at,
      metadata: row.metadata ?? null,
    };
    timeline.push(item);

    if (row.from_agent && row.from_agent_name) {
      const existing = participantMap.get(row.from_agent) ?? {
        agent_id: row.from_agent,
        name: row.from_agent_name,
        role: row.from_agent_role ?? null,
        status: null,
        assigned_task_count: 0,
        contribution_count: 0,
        latest_activity_at: null,
      };
      existing.contribution_count += 1;
      existing.latest_activity_at = row.created_at;
      participantMap.set(row.from_agent, existing);
    }

    if (row.to_agent && row.to_agent_name) {
      const existing = participantMap.get(row.to_agent) ?? {
        agent_id: row.to_agent,
        name: row.to_agent_name,
        role: row.to_agent_role ?? null,
        status: null,
        assigned_task_count: 0,
        contribution_count: 0,
        latest_activity_at: null,
      };
      participantMap.set(row.to_agent, existing);
    }
  }

  for (const row of heartbeatsRes.rows as CollaborationHeartbeatRow[]) {
    const thought = extractHeartbeatThought(row.details);
    if (!thought) {
      continue;
    }

    timeline.push({
      id: row.id,
      kind: 'thought',
      task_id: row.task_id,
      task_title: row.task_title,
      agent_id: row.agent_id,
      agent_name: row.agent_name,
      agent_role: row.agent_role,
      to_agent_id: null,
      to_agent_name: null,
      to_agent_role: null,
      content: thought,
      summary: `${row.agent_name} reasoned out loud.`,
      message_type: 'heartbeat_thought',
      duration_ms: row.duration_ms,
      cost_usd: row.cost_usd,
      created_at: row.created_at,
      metadata: row.details ?? null,
    });

    const existing = participantMap.get(row.agent_id) ?? {
      agent_id: row.agent_id,
      name: row.agent_name,
      role: row.agent_role,
      status: null,
      assigned_task_count: 0,
      contribution_count: 0,
      latest_activity_at: null,
    };
    existing.contribution_count += 1;
    existing.latest_activity_at = row.created_at;
    participantMap.set(row.agent_id, existing);
  }

  timeline.sort((left, right) => left.created_at.localeCompare(right.created_at));

  const thoughtCount = timeline.filter((item) => item.kind === 'thought').length;
  const delegationCount = timeline.filter((item) => item.kind === 'delegation').length;
  const messageCount = timeline.filter((item) =>
    item.kind === 'message' || item.kind === 'supervisor' || item.kind === 'status' || item.kind === 'tool'
  ).length;

  return {
    generated_at: new Date().toISOString(),
    root_task: {
      id: rootTask.id,
      title: rootTask.title,
      description: rootTask.description,
      status: rootTask.status,
    },
    current_task: {
      id: currentTask.id,
      title: currentTask.title,
      description: currentTask.description,
      status: currentTask.status,
    },
    tasks: tasks.map((task) => ({
      id: task.id,
      parent_id: task.parent_id,
      title: task.title,
      description: task.description,
      status: task.status,
      assigned_to: task.assigned_to,
      assigned_to_name: task.assigned_to_name,
      assigned_to_role: task.assigned_to_role,
      assigned_to_status: task.assigned_to_status,
      priority: task.priority,
      depth: task.depth,
      created_at: task.created_at,
      updated_at: task.updated_at,
    })),
    participants: Array.from(participantMap.values()).sort((left, right) => {
      if (right.contribution_count !== left.contribution_count) {
        return right.contribution_count - left.contribution_count;
      }
      return left.name.localeCompare(right.name);
    }),
    timeline,
    summary: {
      task_count: tasks.length,
      participant_count: participantMap.size,
      thought_count: thoughtCount,
      message_count: messageCount,
      delegation_count: delegationCount,
    },
  };
}
