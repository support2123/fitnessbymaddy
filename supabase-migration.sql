-- Supabase Migration: FitnessByMaddy Automation Pipeline
-- Run this in the Supabase SQL Editor

-- LEADS TABLE
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  name TEXT DEFAULT '',
  source TEXT DEFAULT 'whatsapp',
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
  first_msg TEXT DEFAULT '',
  last_msg_at TIMESTAMPTZ,
  program_interest TEXT,
  market TEXT DEFAULT 'GLOBAL' CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
  intake_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);

-- CLIENTS TABLE
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  program TEXT CHECK (program IN ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at TIMESTAMPTZ DEFAULT NOW(),
  program_ends_at TIMESTAMPTZ,
  paid_amount INTEGER DEFAULT 0,
  checkout_id TEXT DEFAULT '',
  folder_url TEXT DEFAULT '',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'refunded'))
);

CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_lead ON clients(lead_id);

-- CHECKINS TABLE
CREATE TABLE IF NOT EXISTS checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT NOW(),
  weight DECIMAL(5,1),
  waist DECIMAL(4,1),
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT DEFAULT '',
  photos_urls TEXT[] DEFAULT '{}',
  next_week_focus TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins(client_id);
CREATE INDEX IF NOT EXISTS idx_checkins_week ON checkins(client_id, week_no);

-- PROGRAMS TABLE
CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  pdf_url TEXT DEFAULT '',
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB DEFAULT '{}'::jsonb,
  nutrition_plan JSONB DEFAULT '{}'::jsonb,
  notes TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_programs_client ON programs(client_id);
CREATE INDEX IF NOT EXISTS idx_programs_generated ON programs(generated_at DESC);

-- MESSAGES TABLE (audit trail)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT DEFAULT '',
  template_name TEXT DEFAULT '',
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent'
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(phone, direction);
CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at DESC);

-- ROW LEVEL SECURITY
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (for API endpoints)
CREATE POLICY "Service role full access" ON leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON checkins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON messages FOR ALL USING (true) WITH CHECK (true);

-- Storage bucket for program PDFs and photos
INSERT INTO storage.buckets (id, name, public) VALUES ('programs', 'programs', true)
ON CONFLICT (id) DO NOTHING;
