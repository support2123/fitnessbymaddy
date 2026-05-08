-- FitnessByMaddy — Full Schema
-- Run this in Supabase SQL Editor to create all tables

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
  paid_amount DECIMAL(10,2) DEFAULT 0,
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- Check-ins table (weekly)
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
  photos_urls TEXT[] DEFAULT '{}',
  next_week_focus TEXT
);
CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins(client_id);

-- Programs table (generated weekly per client)
CREATE TABLE IF NOT EXISTS programs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB,
  nutrition_plan JSONB,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_programs_client ON programs(client_id);

-- Messages table (audit trail)
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
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);

-- Intake forms table
CREATE TABLE IF NOT EXISTS intake_forms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  name TEXT,
  email TEXT,
  age INTEGER,
  gender TEXT,
  height TEXT,
  weight DECIMAL(5,1),
  goal TEXT,
  injuries TEXT,
  medical_conditions TEXT,
  diet_preference TEXT,
  activity_level TEXT,
  schedule TEXT,
  equipment_access TEXT,
  photos TEXT[] DEFAULT '{}',
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Nudge queue (for check-in reminders)
CREATE TABLE IF NOT EXISTS nudge_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  nudge_at_24h TIMESTAMPTZ,
  nudge_at_48h TIMESTAMPTZ,
  nudged_24h BOOLEAN DEFAULT FALSE,
  nudged_48h BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Storage bucket for client files
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-files', 'client-files', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies (enable row-level security)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE nudge_queue ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by API)
CREATE POLICY "Service role full access" ON leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON checkins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON intake_forms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON nudge_queue FOR ALL USING (true) WITH CHECK (true);
