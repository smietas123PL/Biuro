import { db } from './db/client.js';
import { logger } from './utils/logger.js';
import { canUseTool, getAgentTools } from './tools/registry.js';
import { evaluatePolicy } from './governance/policies.js';
import { checkSafety, autoPauseAgent } from './orchestrator/safety.js';
import { createApprovalRequest, resolveApproval } from './governance/approvals.js';

async function verifyPhase2() {
  logger.info('Starting Phase 2 Verification...');

  try {
    // 1. Setup Data
    const companyRes = await db.query("INSERT INTO companies (name, mission) VALUES ('Safety Test Corp', 'Safety First') RETURNING id");
    const companyId = companyRes.rows[0].id;

    const agentRes = await db.query(
      "INSERT INTO agents (company_id, name, role, runtime) VALUES ($1, 'Safety Officer', 'Auditor', 'openai') RETURNING id",
      [companyId]
    );
    const agentId = agentRes.rows[0].id;

    const toolRes = await db.query(
      "INSERT INTO tools (company_id, name, type, description) VALUES ($1, 'restricted_tool', 'builtin', 'A restricted tool') RETURNING id",
      [companyId]
    );
    const toolId = toolRes.rows[0].id;

    // 2. Test Tool Permissions
    logger.info('Testing Tool Permissions...');
    const noPerm = await canUseTool(agentId, 'restricted_tool');
    console.log('Initially can use restricted_tool:', noPerm);

    await db.query("INSERT INTO agent_tools (agent_id, tool_id, can_execute) VALUES ($1, $2, true)", [agentId, toolId]);
    const yesPerm = await canUseTool(agentId, 'restricted_tool');
    console.log('After permission granted, can use restricted_tool:', yesPerm);

    // 3. Test Policy Evaluation
    logger.info('Testing Policy Evaluation...');
    await db.query(
      "INSERT INTO policies (company_id, name, type, rules) VALUES ($1, 'No High Spend', 'budget_threshold', '{\"threshold_usd\": 100}')",
      [companyId]
    );
    const policyOk = await evaluatePolicy(companyId, 'budget_threshold', { amount: 50 });
    console.log('Spend $50:', policyOk.allowed ? 'Allowed' : 'Blocked');
    
    const policyBlocked = await evaluatePolicy(companyId, 'budget_threshold', { amount: 500 });
    console.log('Spend $500:', policyBlocked.requires_approval ? 'Requires Approval' : 'Denied');

    // 4. Test Safety System (Flood Detection)
    logger.info('Testing Safety System (Flood Detection)...');
    const taskRes = await db.query("INSERT INTO tasks (company_id, title, status) VALUES ($1, 'Spam Task', 'backlog') RETURNING id", [companyId]);
    const taskId = taskRes.rows[0].id;

    // Simulate 12 messages in a burst
    for(let i=0; i<12; i++) {
        await db.query("INSERT INTO messages (company_id, task_id, from_agent, content) VALUES ($1, $2, $3, 'Spam')", [companyId, taskId, agentId]);
    }

    const safetyCheck = await checkSafety(agentId, taskId);
    console.log('Safety Check after spam:', safetyCheck.ok ? 'OK' : `FAIL: ${safetyCheck.reason}`);

    if(!safetyCheck.ok) {
        await autoPauseAgent(agentId, safetyCheck.reason!);
        const agentStatus = await db.query("SELECT status, config FROM agents WHERE id = $1", [agentId]);
        console.log('Agent status after auto-pause:', agentStatus.rows[0].status, agentStatus.rows[0].config.pause_reason);
    }

    // 5. Test Approval Workflow
    logger.info('Testing Approval Workflow...');
    const appReq = await createApprovalRequest(companyId, taskId, agentId, 'Need to buy coffee', { cost: 5.50 });
    console.log('Created Approval ID:', appReq.id);
    
    const resolved = await resolveApproval(appReq.id, 'approved', 'Coffee is essential');
    console.log('Resolved Approval Status:', resolved.status);

    logger.info('Phase 2 Verification PASSED (Logical)!');
    process.exit(0);

  } catch (err) {
    logger.error({ err }, 'Phase 2 Verification FAILED');
    process.exit(1);
  }
}

verifyPhase2();
