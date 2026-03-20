import { db } from '../db/client.js';
import { runtimeRegistry } from '../runtime/registry.js';
import { extractCompanyRuntimeSettings } from '../runtime/preferences.js';
import { buildAgentContext } from './context.js';
import { findRelatedMemories } from './memory.js';
import { createHeartbeatExecutionTelemetry } from './heartbeatExecutionTelemetry.js';

export async function prepareHeartbeatExecution(agentId: string, task: any) {
  const executionTelemetry = createHeartbeatExecutionTelemetry(2);
  const memories = await findRelatedMemories(
    task.company_id,
    `${task.title} ${task.description}`,
    3,
    {
      agentId,
      taskId: task.id,
      consumer: 'heartbeat_memory',
      retrievalGuard: executionTelemetry.guard,
      onDiagnostic: executionTelemetry.recordRetrieval,
    }
  );

  const agentRes = await db.query(
    'SELECT runtime, name FROM agents WHERE id = $1',
    [agentId]
  );
  const runtimeName = agentRes.rows[0].runtime;
  const agentName = agentRes.rows[0].name;
  const companyConfigRes = await db.query(
    'SELECT config FROM companies WHERE id = $1',
    [task.company_id]
  );
  const runtimeSettings = extractCompanyRuntimeSettings(
    companyConfigRes.rows[0]?.config
  );
  const preferredRuntime = runtimeSettings.primaryRuntime || runtimeName;
  const runtime = runtimeRegistry.getRuntime(preferredRuntime, {
    fallbackOrder: runtimeSettings.fallbackOrder,
  });

  const context = await buildAgentContext(agentId, task.id, {
    retrievalGuard: executionTelemetry.guard,
    onRetrieval: executionTelemetry.recordRetrieval,
  });
  if (memories.length > 0) {
    context.additional_context =
      (context.additional_context || '') +
      `\n\n### PAST EXPERIENCES (MEMORIES):\n${memories.join('\n---\n')}`;
  }

  const sessionRes = await db.query(
    'SELECT state FROM agent_sessions WHERE agent_id = $1 AND task_id = $2',
    [agentId, task.id]
  );
  if (sessionRes.rows.length > 0) {
    context.history.push({
      role: 'user',
      content: `Restoring session. Previous state: ${JSON.stringify(sessionRes.rows[0].state)}`,
    });
  }

  return { agentName, context, runtime, executionTelemetry };
}
