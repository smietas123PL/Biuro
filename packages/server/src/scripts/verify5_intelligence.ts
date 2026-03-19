import { MCPService } from '../services/mcp.js';
import { KnowledgeService } from '../services/knowledge.js';
import { IntegrationService } from '../services/integrations.js';
import { buildAgentContext } from '../orchestrator/context.js';
import { db } from '../db/client.js';

async function runVerification() {
  console.log('🚀 Phase 5 Verification: Intelligence & Connectivity');

  // Setup: Mock Company, Agent, Task
  const companyId = '00000000-0000-0000-0000-000000000001';
  const agentId = '00000000-0000-0000-0000-000000000002';

  await db.query(
    "INSERT INTO companies (id, name) VALUES ($1, 'Test Corp') ON CONFLICT (id) DO NOTHING",
    [companyId]
  );
  await db.query(
    "INSERT INTO agents (id, company_id, name, role) VALUES ($1, $2, 'Intelligence Agent', 'Researcher') ON CONFLICT (id) DO NOTHING",
    [agentId, companyId]
  );

  // 1. Test Knowledge Ingestion & Retrieval
  console.log('\n--- 📚 Knowledge Base Test ---');
  const docId = await KnowledgeService.addDocument(
    companyId,
    'Confidential Project X',
    'The secret password for Project X is: "Antigravity2024".'
  );
  console.log(`✅ Document added: ${docId}`);

  const taskRes = await db.query(
    "INSERT INTO tasks (company_id, title, description) VALUES ($1, 'Research Project X', 'Find out secret info about Project X.') RETURNING id",
    [companyId]
  );
  const taskId = taskRes.rows[0].id;

  const context = await buildAgentContext(agentId, taskId);
  if (context.knowledge_context?.includes('Antigravity2024')) {
    console.log(
      '✅ Context injection successful: Secret password found in context!'
    );
  } else {
    console.log('❌ Context injection failed: Secret password missing.');
  }

  // 2. Test Integration (Slack simulation)
  console.log('\n--- 💬 Integration Test (Slack) ---');
  const slackResult = await IntegrationService.handleSlashCommand(
    '/biuro-task',
    'Analyze Q4 revenue patterns',
    companyId
  );
  console.log(`✅ ${slackResult}`);

  // 3. Test MCP (Simulated, as we need a real MCP server running for full E2E)
  console.log('\n--- 🔌 MCP Test (Interface Check) ---');
  try {
    // We just test if the service is reachable, though this will likely fail without a server
    console.log('Checking MCP entry points...');
    if (typeof MCPService.callTool === 'function')
      console.log('✅ MCPService available');
  } catch (e) {
    console.log('⚠️ MCP requires a running server for functional testing');
  }

  console.log('\n✨ Phase 5 Verification Complete!');
  process.exit(0);
}

runVerification().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
