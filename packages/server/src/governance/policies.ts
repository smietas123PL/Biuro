import { db } from '../db/client.js';

export interface PolicyResult {
  allowed: boolean;
  requires_approval: boolean;
  reason?: string;
  policy_id?: string;
}

export async function evaluatePolicy(
  companyId: string,
  type: string,
  payload: any
): Promise<PolicyResult> {
  const policies = await db.query(
    'SELECT * FROM policies WHERE company_id = $1 AND type = $2 AND is_active = true',
    [companyId, type]
  );

  for (const policy of policies.rows) {
    const rules = policy.rules;

    switch (type) {
      case 'approval_required':
        if (
          Array.isArray(rules.actions) &&
          rules.actions.includes(payload.action)
        ) {
          return {
            allowed: false,
            requires_approval: true,
            reason: `Policy: ${policy.name}`,
            policy_id: policy.id,
          };
        }
        break;

      case 'delegation_limit':
        if (
          typeof rules.max_depth === 'number' &&
          payload.depth > rules.max_depth
        ) {
          return {
            allowed: false,
            requires_approval: false,
            reason: 'Max delegation depth exceeded',
          };
        }
        break;

      case 'budget_threshold':
        if (
          typeof rules.threshold_usd === 'number' &&
          payload.amount > rules.threshold_usd
        ) {
          return {
            allowed: false,
            requires_approval: true,
            reason: 'Budget threshold exceeded',
            policy_id: policy.id,
          };
        }
        break;

      case 'rate_limit': {
        if (!payload.agentId || typeof rules.max_per_hour !== 'number') {
          break;
        }

        const countRes = await db.query(
          `SELECT COUNT(*)::int AS count
           FROM heartbeats
           WHERE agent_id = $1
             AND created_at > now() - interval '1 hour'`,
          [payload.agentId]
        );
        if ((countRes.rows[0]?.count ?? 0) >= rules.max_per_hour) {
          return {
            allowed: false,
            requires_approval: false,
            reason: 'Agent rate limit exceeded',
          };
        }
        break;
      }

      case 'tool_restriction':
        if (
          payload.tool_name &&
          Array.isArray(rules.blocked_tools) &&
          rules.blocked_tools.includes(payload.tool_name)
        ) {
          return {
            allowed: false,
            requires_approval: false,
            reason: `Tool blocked by policy: ${payload.tool_name}`,
          };
        }
        break;
    }
  }

  return { allowed: true, requires_approval: false };
}
