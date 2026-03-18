import { db } from '../db/client.js';

export interface PolicyResult {
  allowed: boolean;
  requires_approval: boolean;
  reason?: string;
  policy_id?: string;
}

export async function evaluatePolicy(companyId: string, type: string, payload: any): Promise<PolicyResult> {
  const policies = await db.query(
    'SELECT * FROM policies WHERE company_id = $1 AND type = $2 AND is_active = true',
    [companyId, type]
  );

  for (const policy of policies.rows) {
    const rules = policy.rules;

    switch (type) {
      case 'approval_required':
        if (rules.actions.includes(payload.action)) {
          return { allowed: false, requires_approval: true, reason: `Policy: ${policy.name}`, policy_id: policy.id };
        }
        break;
      
      case 'delegation_limit':
        if (payload.depth > rules.max_depth) {
          return { allowed: false, requires_approval: false, reason: 'Max delegation depth exceeded' };
        }
        break;

      case 'budget_threshold':
        if (payload.amount > rules.threshold_usd) {
          return { allowed: false, requires_approval: true, reason: 'Budget threshold exceeded', policy_id: policy.id };
        }
        break;
    }
  }

  return { allowed: true, requires_approval: false };
}
