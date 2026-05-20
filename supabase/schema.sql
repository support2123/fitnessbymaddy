-- FitnessByMaddy Database Schema
-- Run this in Supabase SQL Editor to create all required tables

-- LEADS: Every new WhatsApp contact
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

-- CLIENTS: Converted leads who paid
CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  program TEXT CHECK (program IN ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at TIMESTAMPTZ DEFAULT NOW(),
  program_ends_at TIMESTAMPTZ,
  paid_amount NUMERIC(10,2) DEFAULT 0,
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'refunded'))
);

CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_program ON clients(program);

-- CHECKINS: Weekly client check-ins
CREATE TABLE IF NOT EXISTS checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT NOW(),
  weight NUMERIC(5,1),
  waist NUMERIC(5,1),
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT,
  photos_urls TEXT[] DEFAULT '{}',
  next_week_focus TEXT
);

CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins(client_id);
CREATE INDEX IF NOT EXISTS idx_checkins_week ON checkins(client_id, week_no);

-- PROGRAMS: Weekly generated plans (12-week clients)
CREATE TABLE IF NOT EXISTS programs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB DEFAULT '{}',
  nutrition_plan JSONB DEFAULT '{}',
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_programs_client ON programs(client_id);
CREATE INDEX IF NOT EXISTS idx_programs_week ON programs(client_id, week_no);

-- MESSAGES: Audit trail for all WhatsApp messages
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  direction TEXT CHECK (direction IN ('in', 'out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent'
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_messages_template ON messages(template_name);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(phone, direction);

-- INTAKE FORMS: Onboarding data from /intake form
CREATE TABLE IF NOT EXISTS intake_forms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  name TEXT,
  email TEXT,
  phone TEXT,
  age INTEGER,
  gender TEXT,
  goal TEXT,
  injuries TEXT,
  diet_preference TEXT,
  schedule TEXT,
  experience_level TEXT,
  current_weight NUMERIC(5,1),
  target_weight NUMERIC(5,1),
  medical_conditions TEXT,
  supplements TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- RPC: Find clients with 2+ consecutive missed check-ins
CREATE OR REPLACE FUNCTION get_consecutive_missed_checkins()
RETURNS TABLE(client_id UUID, name TEXT, phone TEXT, missed_count BIGINT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS client_id,
    c.name,
    c.phone,
    (expected.week_no - COALESCE(last_checkin.max_week, 0)) AS missed_count
  FROM clients c
  CROSS JOIN LATERAL (
    SELECT CEIL(EXTRACT(EPOCH FROM (NOW() - c.program_started_at)) / (7 * 86400))::INTEGER AS week_no
  ) expected
  LEFT JOIN LATERAL (
    SELECT MAX(ch.week_no) AS max_week
    FROM checkins ch
    WHERE ch.client_id = c.id
  ) last_checkin ON TRUE
  WHERE c.status = 'active'
    AND expected.week_no - COALESCE(last_checkin.max_week, 0) >= 2;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies (enable row-level security but allow service key full access)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_forms ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all data (for admin dashboard)
CREATE POLICY "Authenticated users can read leads" ON leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read clients" ON clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read checkins" ON checkins FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read programs" ON programs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read messages" ON messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read intake_forms" ON intake_forms FOR SELECT TO authenticated USING (true);

-- Service role has full access (handled by Supabase automatically)

-- Create storage bucket for client files
INSERT INTO storage.buckets (id, name, public) VALUES ('client-files', 'client-files', true)
ON CONFLICT (id) DO NOTHING;
