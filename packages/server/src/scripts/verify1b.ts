import { db } from '../db/client.js';
import { processAgentHeartbeat } from '../orchestrator/heartbeat.js';
import { logger } from '../utils/logger.js';

async function verifyPhase1B() {
  logger.info('Starting Phase 1B Verification...');

  try {
    // 1. Create Company
    const company = await db.query(
      'INSERT INTO companies (name, mission) VALUES ($1, $2) RETURNING *',
      ['Test Corp', 'Build a successful AI startup']
    );
    const companyId = company.rows[0].id;
    logger.info({ companyId }, 'Created company');

    // 2. Hire Agent
    const agent = await db.query(
      `INSERT INTO agents (company_id, name, role, runtime, system_prompt) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        companyId,
        'CEO-Bot',
        'CEO',
        'claude',
        'You are a visionary CEO. Decide on the first product.',
      ]
    );
    const agentId = agent.rows[0].id;
    logger.info({ agentId }, 'Hired agent');

    // 3. Add Budget
    await db.query(
      "INSERT INTO budgets (agent_id, month, limit_usd) VALUES ($1, date_trunc('month', now())::date, 10.00)",
      [agentId]
    );

    // 4. Create Task
    const task = await db.query(
      `INSERT INTO tasks (company_id, title, description, assigned_to, status) 
       VALUES ($1, $2, $3, $4, 'backlog') RETURNING *`,
      [
        companyId,
        'Market Research',
        'Decide if we should build a Note App or a CRM.',
        agentId,
      ]
    );
    const taskId = task.rows[0].id;
    logger.info({ taskId }, 'Created task');

    // 5. Trigger Heartbeat (Manual Run)
    logger.info('Triggering manual heartbeat...');
    // We mock the runtime in tests usually, but here we expect env variables to be set
    // This will actually call Anthropic/OpenAI if keys are present.
    await processAgentHeartbeat(agentId);

    // 6. Check Results
    const updatedTask = await db.query(
      'SELECT status, result FROM tasks WHERE id = $1',
      [taskId]
    );
    const audit = await db.query(
      'SELECT action FROM audit_log WHERE agent_id = $1',
      [agentId]
    );
    const messages = await db.query(
      'SELECT content FROM messages WHERE task_id = $1',
      [taskId]
    );

    logger.info(
      {
        taskStatus: updatedTask.rows[0].status,
        auditCount: audit.rows.length,
        messageCount: messages.rows.length,
      },
      'Verification complete'
    );
  } catch (err) {
    logger.error({ err }, 'Verification failed');
  } finally {
    await db.close();
  }
}

verifyPhase1B();
