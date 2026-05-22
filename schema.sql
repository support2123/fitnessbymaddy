-- Supabase Schema for FitnessByMaddy Automation Pipeline
-- Run this in the Supabase SQL Editor to create all tables

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
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);

-- Lead intake details
CREATE TABLE IF NOT EXISTS lead_intake (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  age INTEGER,
  gender TEXT,
  height TEXT,
  weight NUMERIC,
  goal TEXT,
  injuries TEXT,
  diet_pref TEXT,
  schedule TEXT,
  medical_conditions TEXT,
  experience_level TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lead_id)
);

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
  paid_amount NUMERIC DEFAULT 0,
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- Weekly check-ins
CREATE TABLE IF NOT EXISTS checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins(client_id, week_no);

-- Generated programs
CREATE TABLE IF NOT EXISTS programs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB DEFAULT '{}',
  nutrition_plan JSONB DEFAULT '{}',
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_programs_client ON programs(client_id, week_no);

-- Message audit trail
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent'
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction, sent_at DESC);

-- Create a storage bucket for program files
-- (Run this via Supabase dashboard or API — SQL can't create storage buckets)
-- Bucket name: "programs" (public access for PDF links)

-- Enable Row Level Security (RLS) — service key bypasses these
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_intake ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Service role policy (full access for backend)
CREATE POLICY "Service role full access" ON leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON lead_intake FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON checkins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON messages FOR ALL USING (true) WITH CHECK (true);
