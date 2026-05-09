-- FitnessByMaddy Automation Pipeline — Supabase Schema
-- Run this in the Supabase SQL Editor to create all tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- LEADS
-- ============================================
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT NOT NULL,
  name TEXT,
  source TEXT DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
  first_msg TEXT,
  last_msg_at TIMESTAMPTZ DEFAULT now(),
  program_interest TEXT,
  market TEXT DEFAULT 'GLOBAL'
    CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads (phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);

-- ============================================
-- CLIENTS
-- ============================================
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  program TEXT NOT NULL
    CHECK (program IN ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at TIMESTAMPTZ DEFAULT now(),
  program_ends_at TIMESTAMPTZ,
  paid_amount INTEGER DEFAULT 0,
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients (phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients (status);
CREATE INDEX IF NOT EXISTS idx_clients_lead ON clients (lead_id);

-- ============================================
-- CHECKINS (weekly)
-- ============================================
CREATE TABLE IF NOT EXISTS checkins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT now(),
  weight NUMERIC(5,1),
  waist NUMERIC(5,1),
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT,
  photos_urls TEXT[] DEFAULT '{}',
  next_week_focus TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins (client_id);
CREATE INDEX IF NOT EXISTS idx_checkins_week ON checkins (client_id, week_no);

-- ============================================
-- PROGRAMS (generated weekly per client)
-- ============================================
CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT now(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB DEFAULT '{}',
  nutrition_plan JSONB DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_programs_client ON programs (client_id);
CREATE INDEX IF NOT EXISTS idx_programs_week ON programs (client_id, week_no);

-- ============================================
-- MESSAGES (audit trail)
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT DEFAULT '',
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'sent',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages (phone);
CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages (sent_at);

-- ============================================
-- ROW LEVEL SECURITY (service key bypasses, but good practice)
-- ============================================
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "Service role full access" ON leads FOR ALL USING (true);
CREATE POLICY "Service role full access" ON clients FOR ALL USING (true);
CREATE POLICY "Service role full access" ON checkins FOR ALL USING (true);
CREATE POLICY "Service role full access" ON programs FOR ALL USING (true);
CREATE POLICY "Service role full access" ON messages FOR ALL USING (true);
