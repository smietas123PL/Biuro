import { env } from '../env.js';
import { db } from '../db/client.js';

export interface PolicyResult {
  allowed: boolean;
  requires_approval: boolean;
  reason?: string;
  policy_id?: string;
}

type PolicyRow = {
  id: string;
  name: string;
  rules: Record<string, unknown>;
};

type PolicyCacheEntry = {
  expiresAt: number;
  policies: PolicyRow[];
};

const policyCache = new Map<string, PolicyCacheEntry>();

function getPolicyCacheKey(companyId: string, type: string) {
  return `${companyId}:${type}`;
}

async function getActivePolicies(companyId: string, type: string) {
  const cacheKey = getPolicyCacheKey(companyId, type);
  const now = Date.now();
  const cached = policyCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return cached.policies;
  }

  const result = await db.query(
    'SELECT * FROM policies WHERE company_id = $1 AND type = $2 AND is_active = true',
    [companyId, type]
  );
  const policies = result.rows as PolicyRow[];

  if (env.POLICY_CACHE_TTL_MS > 0) {
    policyCache.set(cacheKey, {
      expiresAt: now + env.POLICY_CACHE_TTL_MS,
      policies,
    });
  } else {
    policyCache.delete(cacheKey);
  }

  return policies;
}

export function invalidatePolicyCache(companyId?: string) {
  if (!companyId) {
    policyCache.clear();
    return;
  }

  const prefix = `${companyId}:`;
  for (const key of policyCache.keys()) {
    if (key.startsWith(prefix)) {
      policyCache.delete(key);
    }
  }
}

export async function evaluatePolicy(
  companyId: string,
  type: string,
  payload: any
): Promise<PolicyResult> {
  const policies = await getActivePolicies(companyId, type);

  for (const policy of policies) {
    const rules = policy.rules;

    switch (type) {
      case 'approval_required':
        if (
          !Array.isArray(rules.actions) ||
          !rules.actions.includes(payload.action)
        ) {
          break;
        }

        if (
          Array.isArray(rules.tool_names) &&
          payload.tool_name &&
          !rules.tool_names.includes(payload.tool_name)
        ) {
          break;
        }

        if (Array.isArray(rules.tool_names) && !payload.tool_name) {
          break;
        }

        return {
          allowed: false,
          requires_approval: true,
          reason: `Policy: ${policy.name}`,
          policy_id: policy.id,
        };
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
