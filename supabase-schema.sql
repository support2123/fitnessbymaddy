-- Supabase Schema for FitnessByMaddy Automation Pipeline
-- Run this in Supabase SQL Editor to set up all tables

-- LEADS table
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
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

-- CLIENTS table
CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  program TEXT CHECK (program IN ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at TIMESTAMPTZ,
  program_ends_at TIMESTAMPTZ,
  paid_amount NUMERIC(10,2) DEFAULT 0,
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'refunded'))
);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- CHECKINS table (weekly)
CREATE TABLE IF NOT EXISTS checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT now(),
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

-- PROGRAMS table (generated weekly per client)
CREATE TABLE IF NOT EXISTS programs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT now(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB,
  nutrition_plan JSONB,
  notes TEXT,
  UNIQUE(client_id, week_no)
);
CREATE INDEX IF NOT EXISTS idx_programs_client ON programs(client_id);

-- MESSAGES table (audit trail)
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'sent'
);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at);

-- INTAKE_FORMS table (onboarding data)
CREATE TABLE IF NOT EXISTS intake_forms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  name TEXT,
  email TEXT,
  phone TEXT,
  age INTEGER,
  gender TEXT,
  height TEXT,
  weight NUMERIC(5,1),
  goal TEXT,
  injuries TEXT,
  medical_conditions TEXT,
  diet_preference TEXT,
  workout_days INTEGER,
  workout_location TEXT,
  wake_time TEXT,
  sleep_time TEXT,
  supplements TEXT,
  motivation TEXT,
  photos JSONB DEFAULT '[]',
  submitted_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intake_lead ON intake_forms(lead_id);

-- Create storage bucket for client files
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-files', 'client-files', true)
ON CONFLICT (id) DO NOTHING;

-- Row Level Security (RLS) policies
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_forms ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (used by API)
CREATE POLICY "Service role full access on leads" ON leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on clients" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on checkins" ON checkins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on programs" ON programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on messages" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on intake_forms" ON intake_forms FOR ALL USING (true) WITH CHECK (true);

-- Authenticated users (admin dashboard) can read all
CREATE POLICY "Authenticated read leads" ON leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read clients" ON clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read checkins" ON checkins FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read programs" ON programs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read messages" ON messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read intake_forms" ON intake_forms FOR SELECT TO authenticated USING (true);

-- Storage policy for client files
CREATE POLICY "Public read client files" ON storage.objects FOR SELECT USING (bucket_id = 'client-files');
CREATE POLICY "Service write client files" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'client-files');
CREATE POLICY "Service update client files" ON storage.objects FOR UPDATE USING (bucket_id = 'client-files');
