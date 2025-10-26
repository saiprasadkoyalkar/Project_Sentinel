-- Sentinel Support System Database Schema
-- Run this script in pgAdmin to create all tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create tables
CREATE TABLE customers (
    id VARCHAR(50) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    full_name VARCHAR(255) NOT NULL,
    date_of_birth DATE,
    address JSONB,
    kyc_status VARCHAR(20) DEFAULT 'pending',
    risk_level VARCHAR(10) DEFAULT 'low',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE accounts (
    id VARCHAR(50) PRIMARY KEY,
    customer_id VARCHAR(50) NOT NULL REFERENCES customers(id),
    account_type VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    balance DECIMAL(15,2) DEFAULT 0.00,
    currency VARCHAR(3) DEFAULT 'USD',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE cards (
    id VARCHAR(50) PRIMARY KEY,
    customer_id VARCHAR(50) NOT NULL REFERENCES customers(id),
    account_id VARCHAR(50) NOT NULL REFERENCES accounts(id),
    pan VARCHAR(255) NOT NULL, -- Encrypted
    expiry_month INTEGER NOT NULL,
    expiry_year INTEGER NOT NULL,
    card_type VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    daily_limit DECIMAL(10,2) DEFAULT 1000.00,
    monthly_limit DECIMAL(12,2) DEFAULT 10000.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE transactions (
    id VARCHAR(50) PRIMARY KEY,
    customer_id VARCHAR(50) NOT NULL REFERENCES customers(id),
    card_id VARCHAR(50) REFERENCES cards(id),
    amount DECIMAL(12,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    merchant VARCHAR(255) NOT NULL,
    mcc VARCHAR(10) NOT NULL,
    description TEXT,
    ts TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) DEFAULT 'completed',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE alerts (
    id VARCHAR(50) PRIMARY KEY,
    customer_id VARCHAR(50) NOT NULL REFERENCES customers(id),
    suspect_txn_id VARCHAR(50) REFERENCES transactions(id),
    alert_type VARCHAR(50) NOT NULL,
    risk VARCHAR(10) NOT NULL,
    status VARCHAR(20) DEFAULT 'OPEN',
    details JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE cases (
    id VARCHAR(50) PRIMARY KEY,
    customer_id VARCHAR(50) NOT NULL REFERENCES customers(id),
    alert_id VARCHAR(50) REFERENCES alerts(id),
    case_type VARCHAR(50) NOT NULL,
    priority VARCHAR(10) DEFAULT 'medium',
    status VARCHAR(20) DEFAULT 'open',
    assigned_to VARCHAR(50),
    resolution TEXT,
    events JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE triage_runs (
    id VARCHAR(50) PRIMARY KEY,
    customer_id VARCHAR(50) NOT NULL REFERENCES customers(id),
    trigger_type VARCHAR(20) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    risk_score INTEGER,
    recommendations JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE agent_traces (
    id VARCHAR(50) PRIMARY KEY,
    triage_run_id VARCHAR(50) NOT NULL REFERENCES triage_runs(id),
    agent_name VARCHAR(50) NOT NULL,
    step_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    input_data JSONB,
    output_data JSONB,
    error_message TEXT,
    execution_time_ms INTEGER,
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE kb_docs (
    id VARCHAR(50) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content_text TEXT NOT NULL,
    category VARCHAR(50),
    tags TEXT[],
    version VARCHAR(10) DEFAULT '1.0',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE policies (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL,
    rules JSONB NOT NULL,
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_risk_level ON customers(risk_level);

CREATE INDEX idx_accounts_customer_id ON accounts(customer_id);
CREATE INDEX idx_accounts_status ON accounts(status);

CREATE INDEX idx_cards_customer_id ON cards(customer_id);
CREATE INDEX idx_cards_account_id ON cards(account_id);
CREATE INDEX idx_cards_status ON cards(status);

CREATE INDEX idx_transactions_customer_id ON transactions(customer_id);
CREATE INDEX idx_transactions_card_id ON cards(card_id);
CREATE INDEX idx_transactions_ts ON transactions(ts);
CREATE INDEX idx_transactions_merchant ON transactions(merchant);
CREATE INDEX idx_transactions_amount ON transactions(amount);

CREATE INDEX idx_alerts_customer_id ON alerts(customer_id);
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_risk ON alerts(risk);
CREATE INDEX idx_alerts_created_at ON alerts(created_at);

CREATE INDEX idx_cases_customer_id ON cases(customer_id);
CREATE INDEX idx_cases_status ON cases(status);
CREATE INDEX idx_cases_priority ON cases(priority);

CREATE INDEX idx_triage_runs_customer_id ON triage_runs(customer_id);
CREATE INDEX idx_triage_runs_status ON triage_runs(status);
CREATE INDEX idx_triage_runs_started_at ON triage_runs(started_at);

CREATE INDEX idx_agent_traces_triage_run_id ON agent_traces(triage_run_id);
CREATE INDEX idx_agent_traces_agent_name ON agent_traces(agent_name);
CREATE INDEX idx_agent_traces_status ON agent_traces(status);

CREATE INDEX idx_kb_docs_category ON kb_docs(category);
CREATE INDEX idx_kb_docs_is_active ON kb_docs(is_active);

CREATE INDEX idx_policies_category ON policies(category);
CREATE INDEX idx_policies_is_active ON policies(is_active);

-- Insert some basic knowledge base documents
INSERT INTO kb_docs (id, title, content_text, category, tags) VALUES
('kb_001', 'Card Freezing Procedures', 'To freeze a customer card: 1. Verify customer identity with OTP, 2. Check for pending transactions, 3. Set card status to frozen, 4. Send notification to customer', 'procedures', ARRAY['card', 'freeze', 'security']),
('kb_002', 'Dispute Resolution Process', 'For transaction disputes: 1. Gather transaction details, 2. Contact merchant if possible, 3. File dispute with card network, 4. Provide provisional credit if eligible', 'procedures', ARRAY['dispute', 'transaction', 'resolution']),
('kb_003', 'High Risk Transaction Indicators', 'Red flags include: Large amounts (>$5000), Foreign merchants, Late night transactions, Multiple failed attempts, Unusual merchant categories', 'guidelines', ARRAY['risk', 'fraud', 'detection']),
('kb_004', 'Customer Communication Templates', 'Standard templates for: Account security alerts, Transaction confirmations, Dispute updates, Card replacement notifications', 'templates', ARRAY['communication', 'templates']),
('kb_005', 'Regulatory Compliance Requirements', 'Must comply with: PCI DSS for card data, GDPR for EU customers, SOX for financial reporting, AML for suspicious activity reporting', 'compliance', ARRAY['regulatory', 'compliance', 'legal']);

-- Insert basic policies
INSERT INTO policies (id, name, category, rules, priority) VALUES
('pol_001', 'Daily Transaction Limit', 'transaction_limits', '{"daily_limit": 5000, "currency": "USD", "exceptions": ["business_accounts"]}', 100),
('pol_002', 'Fraud Detection Thresholds', 'fraud_detection', '{"velocity_threshold": 10, "amount_threshold": 2000, "foreign_transaction_review": true}', 200),
('pol_003', 'Account Freeze Criteria', 'security', '{"suspicious_activity_score": 80, "failed_login_attempts": 5, "require_manager_approval": true}', 150),
('pol_004', 'Customer Data Retention', 'compliance', '{"retention_period_years": 7, "anonymize_after_closure": true, "backup_encryption_required": true}', 300),
('pol_005', 'Dispute Processing Timeline', 'customer_service', '{"initial_response_hours": 24, "investigation_days": 10, "provisional_credit_days": 2}', 250);

COMMENT ON TABLE customers IS 'Customer master data with KYC and risk information';
COMMENT ON TABLE accounts IS 'Bank accounts linked to customers';
COMMENT ON TABLE cards IS 'Payment cards issued to customers';
COMMENT ON TABLE transactions IS 'All payment transactions processed';
COMMENT ON TABLE alerts IS 'Fraud and risk alerts generated by the system';
COMMENT ON TABLE cases IS 'Customer service cases for manual review';
COMMENT ON TABLE triage_runs IS 'AI agent triage workflow executions';
COMMENT ON TABLE agent_traces IS 'Detailed traces of each agent step in triage';
COMMENT ON TABLE kb_docs IS 'Knowledge base documents for agent reference';
COMMENT ON TABLE policies IS 'Business rules and policy configurations';

SELECT 'Database schema created successfully!' as status;