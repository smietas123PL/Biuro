import { randomUUID } from 'crypto';
import { newDb, DataType } from 'pg-mem';

const heartbeatTestSchema = `
  CREATE TABLE companies (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    mission TEXT,
    slack_webhook_url TEXT,
    discord_webhook_url TEXT
  );

  CREATE TABLE agents (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    runtime TEXT NOT NULL DEFAULT 'openai',
    model TEXT,
    system_prompt TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    monthly_budget_usd NUMERIC(10, 2) NOT NULL DEFAULT 0,
    config JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    month DATE NOT NULL,
    limit_usd NUMERIC(10, 2) NOT NULL DEFAULT 50.00,
    spent_usd NUMERIC(10, 4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(agent_id, month)
  );

  CREATE TABLE tasks (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL,
    goal_id UUID,
    parent_id UUID,
    title TEXT NOT NULL,
    description TEXT,
    assigned_to UUID,
    status TEXT NOT NULL DEFAULT 'backlog',
    priority INT NOT NULL DEFAULT 0,
    locked_by UUID,
    locked_at TIMESTAMPTZ,
    result TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
  );

  CREATE TABLE heartbeats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    task_id UUID,
    status TEXT NOT NULL,
    duration_ms INT,
    cost_usd NUMERIC(10, 6),
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    agent_id UUID,
    action TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    cost_usd NUMERIC(10, 6),
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE agent_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL,
    task_id UUID NOT NULL,
    state JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(agent_id, task_id)
  );

  CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    task_id UUID,
    from_agent UUID,
    to_agent UUID,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'message',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    task_id UUID NOT NULL,
    requested_by_agent UUID,
    policy_id UUID,
    reason TEXT NOT NULL,
    payload JSONB DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    resolution_notes TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
  );
`;

function truncateDate(part: string, value: Date) {
  const normalized = new Date(value);
  if (part === 'month') {
    normalized.setUTCDate(1);
    normalized.setUTCHours(0, 0, 0, 0);
    return normalized;
  }

  if (part === 'day') {
    normalized.setUTCHours(0, 0, 0, 0);
    return normalized;
  }

  return normalized;
}

export async function createPgMemDb() {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    implementation: () => randomUUID(),
  });
  mem.public.registerFunction({
    name: 'date_trunc',
    args: [DataType.text, DataType.timestamp],
    returns: DataType.timestamp,
    implementation: (part: string, value: Date) => truncateDate(part, value),
  });
  mem.public.registerFunction({
    name: 'date_trunc',
    args: [DataType.text, DataType.timestamptz],
    returns: DataType.timestamptz,
    implementation: (part: string, value: Date) => truncateDate(part, value),
  });

  mem.public.none(heartbeatTestSchema);

  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();

  return {
    mem,
    pool,
    query: <T = any>(text: string, params?: any[]) => pool.query<T>(text, params),
    transaction: async <T>(fn: (client: any) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
