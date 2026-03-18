import { db } from '../db/client.js';
import { AgentContext } from '../types/agent.js';
import { KnowledgeService } from '../services/knowledge.js';

export async function buildAgentContext(agentId: string, taskId: string): Promise<AgentContext> {
  // 1. Get Agent, Company, and Task
  const agentRes = await db.query(
    `SELECT a.*, c.name as company_name, c.mission as company_mission 
     FROM agents a 
     JOIN companies c ON a.company_id = c.id 
     WHERE a.id = $1`,
    [agentId]
  );
  if (agentRes.rows.length === 0) throw new Error('Agent not found');
  const agent = agentRes.rows[0];

  const taskRes = await db.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
  if (taskRes.rows.length === 0) throw new Error('Task not found');
  const task = taskRes.rows[0];

  // 2. Build Goal Hierarchy
  const hierarchy: string[] = [];
  if (task.goal_id) {
    const goalHierarchyRes = await db.query(
      `WITH RECURSIVE goal_path AS (
         SELECT id, parent_id, title, 0 AS depth
         FROM goals
         WHERE id = $1
         UNION ALL
         SELECT g.id, g.parent_id, g.title, gp.depth + 1
         FROM goals g
         JOIN goal_path gp ON gp.parent_id = g.id
       )
       SELECT title
       FROM goal_path
       ORDER BY depth DESC`,
      [task.goal_id]
    );
    hierarchy.push(...goalHierarchyRes.rows.map((row) => row.title as string));
  }

  // 3. Get History (Last 20 messages)
  const messagesRes = await db.query(
    `SELECT * FROM messages 
     WHERE task_id = $1 
     ORDER BY created_at DESC 
     LIMIT 20`,
    [taskId]
  );
  
  const history = messagesRes.rows.reverse().map(m => ({
    role: (m.from_agent === agentId ? 'assistant' : 'user') as 'assistant' | 'user',
    content: m.content,
    metadata: m.metadata
  }));

  // 4. Search Knowledge Base
  const knowledgeRes = await KnowledgeService.search(agent.company_id, task.description || task.title, 5, {
    agentId,
    taskId,
    consumer: 'agent_context',
  });
  const knowledge_context = knowledgeRes.length > 0
    ? `COMPANY KNOWLEDGE:\n${knowledgeRes.map(k => `--- ${k.title} ---\n${k.content}`).join('\n')}`
    : undefined;

  return {
    company_name: agent.company_name,
    company_mission: agent.company_mission,
    agent_name: agent.name,
    agent_role: agent.role,
    agent_model: agent.model,
    agent_system_prompt: agent.system_prompt,
    knowledge_context,
    goal_hierarchy: hierarchy,
    current_task: {
      title: task.title,
      description: task.description,
    },
    history,
  };
}
