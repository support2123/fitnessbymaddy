-- FitnessByMaddy automation pipeline schema
-- Run this in Supabase SQL editor to set up all tables

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  name text,
  source text DEFAULT 'whatsapp',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','qualified','converted','dropped')),
  first_msg text,
  last_msg_at timestamptz DEFAULT now(),
  program_interest text,
  market text DEFAULT 'IN' CHECK (market IN ('IN','UAE','UK','GLOBAL')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id),
  phone text NOT NULL,
  name text,
  email text,
  program text NOT NULL CHECK (program IN ('6wk_gym','6wk_home','12wk','pcos','40plus','zoom_trial','zoom_pack')),
  program_started_at timestamptz DEFAULT now(),
  program_ends_at timestamptz,
  paid_amount integer,
  checkout_id text,
  folder_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','refunded')),
  age integer,
  goal text,
  injuries text,
  diet_pref text,
  schedule text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  week_no integer NOT NULL,
  form_submitted_at timestamptz DEFAULT now(),
  weight numeric,
  waist numeric,
  compliance_score integer CHECK (compliance_score BETWEEN 1 AND 10),
  energy integer CHECK (energy BETWEEN 1 AND 10),
  issues text,
  photos_urls text[],
  next_week_focus text
);

CREATE TABLE IF NOT EXISTS programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  week_no integer NOT NULL,
  generated_at timestamptz DEFAULT now(),
  pdf_url text,
  whatsapp_sent_at timestamptz,
  workout_plan jsonb,
  nutrition_plan jsonb,
  notes text
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  body text,
  template_name text,
  sent_at timestamptz DEFAULT now(),
  status text DEFAULT 'sent'
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_checkins_client_week ON checkins(client_id, week_no);
CREATE INDEX IF NOT EXISTS idx_programs_client_week ON programs(client_id, week_no);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);

-- Enable RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Service role can do everything (used by serverless functions)
CREATE POLICY "service_all_leads" ON leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_clients" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_checkins" ON checkins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_programs" ON programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_messages" ON messages FOR ALL USING (true) WITH CHECK (true);
