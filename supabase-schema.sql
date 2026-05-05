-- FitnessByMaddy Database Schema
-- Run this in Supabase SQL Editor to create all tables

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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_status ON leads(status);

-- CLIENTS TABLE
CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  program TEXT CHECK (program IN ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at TIMESTAMPTZ,
  program_ends_at TIMESTAMPTZ,
  paid_amount DECIMAL(10,2) DEFAULT 0,
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clients_phone ON clients(phone);
CREATE INDEX idx_clients_status ON clients(status);

-- CHECKINS TABLE (weekly)
CREATE TABLE IF NOT EXISTS checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT NOW(),
  weight DECIMAL(5,1),
  waist DECIMAL(5,1),
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT,
  photos_urls JSONB DEFAULT '[]',
  next_week_focus TEXT,
  UNIQUE(client_id, week_no)
);

CREATE INDEX idx_checkins_client ON checkins(client_id);

-- PROGRAMS TABLE (generated weekly)
CREATE TABLE IF NOT EXISTS programs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB,
  nutrition_plan JSONB,
  notes TEXT,
  UNIQUE(client_id, week_no)
);

CREATE INDEX idx_programs_client ON programs(client_id);

-- MESSAGES TABLE (audit trail)
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  direction TEXT CHECK (direction IN ('in', 'out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent'
);

CREATE INDEX idx_messages_phone ON messages(phone);
CREATE INDEX idx_messages_sent ON messages(sent_at);

-- LEAD INTAKE FORM DATA
CREATE TABLE IF NOT EXISTS lead_intake (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  age INTEGER,
  gender TEXT,
  height TEXT,
  weight DECIMAL(5,1),
  goal TEXT,
  injuries TEXT,
  diet_preference TEXT,
  training_days INTEGER,
  wake_time TEXT,
  sleep_time TEXT,
  supplements TEXT,
  medical_conditions TEXT,
  photos JSONB DEFAULT '[]',
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- STORAGE BUCKET
-- Run separately: CREATE STORAGE BUCKET 'programs' (public)
-- In Supabase Dashboard: Storage → Create Bucket → Name: "programs" → Public: Yes

-- ROW LEVEL SECURITY (basic — admin only for service key)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_intake ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by Vercel functions)
CREATE POLICY "Service role full access" ON leads FOR ALL USING (true);
CREATE POLICY "Service role full access" ON clients FOR ALL USING (true);
CREATE POLICY "Service role full access" ON checkins FOR ALL USING (true);
CREATE POLICY "Service role full access" ON programs FOR ALL USING (true);
CREATE POLICY "Service role full access" ON messages FOR ALL USING (true);
CREATE POLICY "Service role full access" ON lead_intake FOR ALL USING (true);
