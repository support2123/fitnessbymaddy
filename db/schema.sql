-- FitnessByMaddy Automation Schema
-- Run this in Supabase SQL Editor

-- Leads table
CREATE TABLE IF NOT EXISTS leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  name text,
  source text DEFAULT 'whatsapp',
  status text DEFAULT 'new' CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
  first_msg text,
  last_msg_at timestamptz DEFAULT now(),
  program_interest text,
  market text DEFAULT 'IN' CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
  created_at timestamptz DEFAULT now(),
  opted_out boolean DEFAULT false,
  UNIQUE(phone)
);

-- Clients table
CREATE TABLE IF NOT EXISTS clients (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid REFERENCES leads(id),
  phone text NOT NULL,
  name text,
  email text,
  program text CHECK (program IN ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at timestamptz DEFAULT now(),
  program_ends_at timestamptz,
  paid_amount integer,
  checkout_id text,
  folder_url text,
  status text DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(phone)
);

-- Weekly check-ins
CREATE TABLE IF NOT EXISTS checkins (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid REFERENCES clients(id) NOT NULL,
  week_no integer NOT NULL,
  form_submitted_at timestamptz DEFAULT now(),
  weight numeric,
  waist numeric,
  compliance_score integer CHECK (compliance_score BETWEEN 1 AND 10),
  energy integer CHECK (energy BETWEEN 1 AND 10),
  issues text,
  photos_urls text[] DEFAULT '{}',
  next_week_focus text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(client_id, week_no)
);

-- Generated programs
CREATE TABLE IF NOT EXISTS programs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid REFERENCES clients(id) NOT NULL,
  week_no integer NOT NULL,
  generated_at timestamptz DEFAULT now(),
  pdf_url text,
  whatsapp_sent_at timestamptz,
  workout_plan jsonb,
  nutrition_plan jsonb,
  notes text,
  flagged_for_review boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(client_id, week_no)
);

-- Message audit trail
CREATE TABLE IF NOT EXISTS messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  body text,
  template_name text,
  sent_at timestamptz DEFAULT now(),
  status text DEFAULT 'sent'
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_last_msg ON leads(last_msg_at);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins(client_id);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_programs_client ON programs(client_id);

-- Row Level Security
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (API uses service key)
CREATE POLICY "Service role full access" ON leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON checkins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON messages FOR ALL USING (true) WITH CHECK (true);
