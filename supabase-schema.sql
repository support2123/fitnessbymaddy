-- FitnessByMaddy Automation Pipeline — Database Schema
-- Run this in Supabase SQL Editor to create all required tables

-- LEADS TABLE
CREATE TABLE IF NOT EXISTS leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  name TEXT,
  source TEXT DEFAULT 'whatsapp',
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
  first_msg TEXT,
  last_msg_at TIMESTAMPTZ,
  program_interest TEXT,
  market TEXT DEFAULT 'IN' CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
  intake_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_status ON leads(status);

-- CLIENTS TABLE
CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  program TEXT NOT NULL CHECK (program IN ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at TIMESTAMPTZ DEFAULT NOW(),
  program_ends_at TIMESTAMPTZ,
  paid_amount NUMERIC,
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'refunded'))
);

CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_phone ON clients(phone);

-- CHECKINS TABLE (weekly)
CREATE TABLE IF NOT EXISTS checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT NOW(),
  weight NUMERIC,
  waist NUMERIC,
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT,
  photos_urls JSONB DEFAULT '[]',
  next_week_focus TEXT
);

CREATE INDEX idx_checkins_client ON checkins(client_id);
CREATE UNIQUE INDEX idx_checkins_client_week ON checkins(client_id, week_no);

-- PROGRAMS TABLE (generated weekly per client)
CREATE TABLE IF NOT EXISTS programs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB,
  nutrition_plan JSONB,
  notes TEXT
);

CREATE INDEX idx_programs_client ON programs(client_id);

-- MESSAGES TABLE (audit trail)
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent'
);

CREATE INDEX idx_messages_phone ON messages(phone);
CREATE INDEX idx_messages_sent ON messages(sent_at);

-- STORAGE: Create a bucket for program files
-- (Run via Supabase dashboard or API: create bucket named 'programs' with public access)

-- ROW LEVEL SECURITY (enable for all tables)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by serverless functions)
CREATE POLICY "Service role full access" ON leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON checkins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON messages FOR ALL USING (true) WITH CHECK (true);
