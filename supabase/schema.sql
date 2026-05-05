-- FitnessByMaddy Database Schema
-- Run this in Supabase SQL Editor to create all tables

-- ═══════════════════════════════════════════════
-- LEADS
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text UNIQUE NOT NULL,
  name text,
  email text,
  source text DEFAULT 'whatsapp',
  status text DEFAULT 'new' CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
  first_msg text,
  last_msg_at timestamptz,
  program_interest text,
  market text DEFAULT 'GLOBAL' CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
  intake_data jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_created ON leads(created_at);

-- ═══════════════════════════════════════════════
-- CLIENTS
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id),
  phone text NOT NULL,
  name text,
  email text,
  program text CHECK (program IN ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at timestamptz DEFAULT now(),
  program_ends_at timestamptz,
  paid_amount integer DEFAULT 0,
  checkout_id text,
  folder_url text,
  status text DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_clients_phone ON clients(phone);
CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_program ON clients(program);

-- ═══════════════════════════════════════════════
-- CHECKINS (weekly)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) NOT NULL,
  week_no integer NOT NULL,
  form_submitted_at timestamptz DEFAULT now(),
  weight numeric(5,1),
  waist numeric(5,1),
  compliance_score integer CHECK (compliance_score BETWEEN 1 AND 10),
  energy integer CHECK (energy BETWEEN 1 AND 10),
  issues text,
  photos_urls jsonb DEFAULT '[]',
  next_week_focus text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_checkins_client ON checkins(client_id);
CREATE INDEX idx_checkins_week ON checkins(client_id, week_no);

-- ═══════════════════════════════════════════════
-- PROGRAMS (generated weekly per client)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) NOT NULL,
  week_no integer NOT NULL,
  generated_at timestamptz DEFAULT now(),
  pdf_url text,
  whatsapp_sent_at timestamptz,
  workout_plan jsonb DEFAULT '{}',
  nutrition_plan jsonb DEFAULT '{}',
  notes text,
  status text DEFAULT 'sent' CHECK (status IN ('sent', 'flagged', 'reviewed')),
  safety_issues jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_programs_client ON programs(client_id);
CREATE INDEX idx_programs_week ON programs(client_id, week_no);

-- ═══════════════════════════════════════════════
-- MESSAGES (audit trail)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  body text,
  template_name text,
  sent_at timestamptz DEFAULT now(),
  status text DEFAULT 'sent',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_messages_phone ON messages(phone);
CREATE INDEX idx_messages_direction ON messages(phone, direction);
CREATE INDEX idx_messages_sent ON messages(sent_at);

-- ═══════════════════════════════════════════════
-- STORAGE BUCKET
-- ═══════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public)
VALUES ('clients', 'clients', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to client files
CREATE POLICY "Public read access" ON storage.objects
  FOR SELECT USING (bucket_id = 'clients');

-- Allow service role full access
CREATE POLICY "Service role full access" ON storage.objects
  FOR ALL USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Service role (used by API) gets full access
CREATE POLICY "Service role access" ON leads FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role access" ON clients FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role access" ON checkins FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role access" ON programs FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role access" ON messages FOR ALL USING (auth.role() = 'service_role');

-- Anon role (used by admin dashboard) gets read-only access
CREATE POLICY "Anon read access" ON leads FOR SELECT USING (auth.role() = 'anon');
CREATE POLICY "Anon read access" ON clients FOR SELECT USING (auth.role() = 'anon');
CREATE POLICY "Anon read access" ON checkins FOR SELECT USING (auth.role() = 'anon');
CREATE POLICY "Anon read access" ON programs FOR SELECT USING (auth.role() = 'anon');
CREATE POLICY "Anon read access" ON messages FOR SELECT USING (auth.role() = 'anon');
