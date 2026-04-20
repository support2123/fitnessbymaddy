-- FitnessByMaddy — Full schema migration
-- Run this in Supabase SQL Editor to create all tables

-- =============================================
-- LEADS
-- =============================================
CREATE TABLE IF NOT EXISTS leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  name TEXT,
  source TEXT DEFAULT 'whatsapp',
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
  first_msg TEXT,
  last_msg_at TIMESTAMPTZ,
  program_interest TEXT,
  market TEXT DEFAULT 'GLOBAL' CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads (phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at DESC);

-- =============================================
-- CLIENTS
-- =============================================
CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  program TEXT CHECK (program IN (
    '6wk_gym', '6wk_home', '12wk', 'pcos', '40plus',
    'zoom_trial', 'zoom_pack', NULL
  )),
  program_started_at TIMESTAMPTZ,
  program_ends_at TIMESTAMPTZ,
  paid_amount NUMERIC(10, 2) DEFAULT 0,
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'completed', 'refunded')),
  intake_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients (phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients (status);
CREATE INDEX IF NOT EXISTS idx_clients_lead ON clients (lead_id);

-- =============================================
-- CHECKINS (weekly)
-- =============================================
CREATE TABLE IF NOT EXISTS checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT NOW(),
  weight NUMERIC(5, 1),
  waist NUMERIC(5, 1),
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT,
  photos_urls JSONB DEFAULT '[]'::jsonb,
  next_week_focus TEXT,
  UNIQUE (client_id, week_no)
);

CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins (client_id, week_no DESC);

-- =============================================
-- PROGRAMS (generated weekly per client)
-- =============================================
CREATE TABLE IF NOT EXISTS programs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB DEFAULT '{}'::jsonb,
  nutrition_plan JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  UNIQUE (client_id, week_no)
);

CREATE INDEX IF NOT EXISTS idx_programs_client ON programs (client_id, week_no DESC);

-- =============================================
-- MESSAGES (audit trail)
-- =============================================
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent'
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages (phone, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_template ON messages (template_name);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages (direction, sent_at DESC);

-- =============================================
-- STORAGE BUCKET
-- =============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-files', 'client-files', true)
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- ROW LEVEL SECURITY (basic — service key bypasses)
-- =============================================
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (admin dashboard) to read all data
CREATE POLICY IF NOT EXISTS "Admin read leads" ON leads FOR SELECT TO authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Admin read clients" ON clients FOR SELECT TO authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Admin read checkins" ON checkins FOR SELECT TO authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Admin read programs" ON programs FOR SELECT TO authenticated USING (true);
CREATE POLICY IF NOT EXISTS "Admin read messages" ON messages FOR SELECT TO authenticated USING (true);
