-- Schema v5: Billing & Credits

-- 1. Credits Table (One record per company)
CREATE TABLE company_credits (
    company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    balance DECIMAL(15, 2) DEFAULT 0.00 NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Transactions Table (History of top-ups and usage)
CREATE TABLE billing_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    amount DECIMAL(15, 2) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'top-up', 'usage', 'refund'
    description TEXT,
    stripe_payment_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Enable RLS on new tables
ALTER TABLE company_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_credits_isolation_policy ON company_credits
    USING (company_id = current_setting('app.current_company_id', true)::uuid);

CREATE POLICY billing_transactions_isolation_policy ON billing_transactions
    USING (company_id = current_setting('app.current_company_id', true)::uuid);
