-- ============================================================
-- Fitness by Maddy — Supabase Database Schema
-- Run this in Supabase SQL Editor to create all tables
-- ============================================================

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
  market TEXT DEFAULT 'GLOBAL' CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);

-- CLIENTS TABLE
CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  program TEXT CHECK (program IN ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at TIMESTAMPTZ DEFAULT NOW(),
  program_ends_at TIMESTAMPTZ,
  paid_amount NUMERIC(10,2),
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_lead ON clients(lead_id);

-- CHECKINS TABLE (weekly)
CREATE TABLE IF NOT EXISTS checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT NOW(),
  weight NUMERIC(5,1),
  waist NUMERIC(5,1),
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT,
  photos_urls JSONB DEFAULT '[]',
  next_week_focus TEXT,
  UNIQUE(client_id, week_no)
);

CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins(client_id);

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
  notes TEXT,
  UNIQUE(client_id, week_no)
);

CREATE INDEX IF NOT EXISTS idx_programs_client ON programs(client_id);

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

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);

-- INTAKE PROFILES TABLE
CREATE TABLE IF NOT EXISTS intake_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID UNIQUE REFERENCES leads(id),
  name TEXT,
  email TEXT,
  age INTEGER,
  gender TEXT,
  height TEXT,
  weight NUMERIC(5,1),
  goal TEXT,
  injuries TEXT,
  diet_pref TEXT,
  schedule TEXT,
  medical_conditions TEXT,
  experience_level TEXT,
  equipment_access TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_lead ON intake_profiles(lead_id);

-- STORAGE BUCKET
INSERT INTO storage.buckets (id, name, public) VALUES ('programs', 'programs', true)
ON CONFLICT (id) DO NOTHING;

-- RLS POLICIES (service key bypasses these, anon key uses them for admin dashboard)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read leads" ON leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read clients" ON clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read checkins" ON checkins FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read programs" ON programs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read messages" ON messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read intake_profiles" ON intake_profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role full access leads" ON leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access clients" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access checkins" ON checkins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access programs" ON programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access messages" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access intake_profiles" ON intake_profiles FOR ALL USING (true) WITH CHECK (true);
