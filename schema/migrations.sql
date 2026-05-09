-- ==========================================================
-- FitnessByMaddy — Supabase Database Schema
-- Run this in Supabase SQL Editor to create all tables
-- ==========================================================

-- LEADS
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  name TEXT,
  source TEXT DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
  first_msg TEXT,
  last_msg_at TIMESTAMPTZ,
  program_interest TEXT,
  market TEXT DEFAULT 'GLOBAL'
    CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);

-- CLIENTS
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT DEFAULT '',
  program TEXT NOT NULL
    CHECK (program IN ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  program_ends_at TIMESTAMPTZ,
  paid_amount NUMERIC(10,2) DEFAULT 0,
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'refunded'))
);

CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_program ON clients(program);

-- CHECKINS (weekly)
CREATE TABLE IF NOT EXISTS checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  weight NUMERIC(5,1),
  waist NUMERIC(5,1),
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT,
  photos_urls JSONB DEFAULT '[]'::jsonb,
  next_week_focus TEXT
);

CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins(client_id);
CREATE INDEX IF NOT EXISTS idx_checkins_week ON checkins(client_id, week_no);

-- PROGRAMS (generated weekly per client)
CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB,
  nutrition_plan JSONB,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_programs_client ON programs(client_id);
CREATE INDEX IF NOT EXISTS idx_programs_week ON programs(client_id, week_no);

-- MESSAGES (audit trail)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT DEFAULT 'sent'
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(phone, direction);

-- ==========================================================
-- ROW LEVEL SECURITY (enable for all tables)
-- Admin users get full access, anon gets read for dashboard
-- ==========================================================

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Service role (API functions) gets full access
CREATE POLICY "Service role full access on leads"
  ON leads FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access on clients"
  ON clients FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access on checkins"
  ON checkins FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access on programs"
  ON programs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access on messages"
  ON messages FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Authenticated users (admin dashboard) get read access
CREATE POLICY "Auth users read leads"
  ON leads FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Auth users read clients"
  ON clients FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Auth users read checkins"
  ON checkins FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Auth users read programs"
  ON programs FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Auth users read messages"
  ON messages FOR SELECT
  USING (auth.role() = 'authenticated');

-- ==========================================================
-- STORAGE BUCKET (for PDFs and photos)
-- ==========================================================

-- Run these in Supabase Dashboard > Storage:
-- 1. Create bucket named "programs" (public)
-- 2. Allow uploads from service_role
-- Or run via SQL:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('programs', 'programs', true);
