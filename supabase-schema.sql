-- Supabase Schema for FitnessByMaddy Automation Pipeline
-- Run this in the Supabase SQL editor to set up all tables

-- Leads table
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

-- Clients table
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
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_lead ON clients(lead_id);

-- Check-ins table (weekly)
CREATE TABLE IF NOT EXISTS checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ,
  weight NUMERIC(5,1),
  waist NUMERIC(5,1),
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT,
  photos_urls JSONB DEFAULT '[]',
  next_week_focus TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins(client_id);
CREATE INDEX IF NOT EXISTS idx_checkins_week ON checkins(client_id, week_no);

-- Programs table (generated weekly per client)
CREATE TABLE IF NOT EXISTS programs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ,
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB,
  nutrition_plan JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_programs_client ON programs(client_id);
CREATE INDEX IF NOT EXISTS idx_programs_week ON programs(client_id, week_no);

-- Messages table (audit trail)
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(phone, direction);
CREATE INDEX IF NOT EXISTS idx_messages_template ON messages(template_name);
CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at);

-- Intake forms table
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
  diet_preference TEXT,
  workout_days INTEGER,
  gym_access BOOLEAN DEFAULT FALSE,
  experience_level TEXT,
  medical_conditions TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_lead ON intake_forms(lead_id);

-- Enable Row Level Security
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_forms ENABLE ROW LEVEL SECURITY;

-- RLS policies: service role has full access, authenticated users can read
CREATE POLICY "Service role full access on leads" ON leads FOR ALL USING (true);
CREATE POLICY "Service role full access on clients" ON clients FOR ALL USING (true);
CREATE POLICY "Service role full access on checkins" ON checkins FOR ALL USING (true);
CREATE POLICY "Service role full access on programs" ON programs FOR ALL USING (true);
CREATE POLICY "Service role full access on messages" ON messages FOR ALL USING (true);
CREATE POLICY "Service role full access on intake_forms" ON intake_forms FOR ALL USING (true);

-- Create storage bucket for client files
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-files', 'client-files', true)
ON CONFLICT (id) DO NOTHING;
