import { db } from '../db/client.js';

export async function getAgentTools(agentId: string) {
  const res = await db.query(
    `SELECT t.*, at.config as agent_tool_config 
     FROM tools t
     JOIN agent_tools at ON t.id = at.tool_id
     WHERE at.agent_id = $1 AND at.can_execute = true`,
    [agentId]
  );
  return res.rows;
}

export async function canUseTool(
  agentId: string,
  toolName: string
): Promise<boolean> {
  const res = await db.query(
    `SELECT at.can_execute 
     FROM tools t
     JOIN agent_tools at ON t.id = at.tool_id
     WHERE at.agent_id = $1 AND t.name = $2`,
    [agentId, toolName]
  );
  return res.rows[0]?.can_execute || false;
}
