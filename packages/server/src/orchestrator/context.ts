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
    let currentGoalId = task.goal_id;
    while (currentGoalId) {
      const goalRes = await db.query('SELECT title, parent_id FROM goals WHERE id = $1', [currentGoalId]);
      if (goalRes.rows.length === 0) break;
      hierarchy.unshift(goalRes.rows[0].title);
      currentGoalId = goalRes.rows[0].parent_id;
    }
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
  const knowledgeRes = await KnowledgeService.search(agent.company_id, task.description || task.title);
  const knowledge_context = knowledgeRes.length > 0
    ? `COMPANY KNOWLEDGE:\n${knowledgeRes.map(k => `--- ${k.title} ---\n${k.content}`).join('\n')}`
    : undefined;

  return {
    company_name: agent.company_name,
    company_mission: agent.company_mission,
    agent_name: agent.name,
    agent_role: agent.role,
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
