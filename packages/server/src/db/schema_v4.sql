-- Schema v4: Row Level Security (RLS)

-- 1. Enable RLS on all tables with company_id
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;

-- 2. Create Policies
-- We use a session variable 'app.current_company_id' set by the middleware

-- Companies Policy (Users can only see THEIR company)
CREATE POLICY company_isolation_policy ON companies
    USING (id = current_setting('app.current_company_id', true)::uuid);

-- General Policy Template for tables with company_id
DO $$ 
DECLARE 
    t text;
BEGIN
    FOR t IN 
        SELECT table_name 
        FROM information_schema.columns 
        WHERE column_name = 'company_id' 
        AND table_schema = 'public'
        AND table_name != 'companies'
    LOOP
        EXECUTE format('CREATE POLICY %I_isolation_policy ON %I USING (company_id = current_setting(''app.current_company_id'', true)::uuid)', t, t);
    END LOOP;
END $$;

-- 3. Bypass for Superuser / Internal queries (Optional, but useful if we have a system user)
-- For now, the 'postgres' user (owner) bypasses RLS by default.