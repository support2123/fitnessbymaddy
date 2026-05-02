-- FitnessByMaddy Supabase Schema
-- Run this in Supabase SQL Editor to create all tables

CREATE TABLE IF NOT EXISTS leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  name text,
  source text DEFAULT 'whatsapp',
  status text DEFAULT 'new' CHECK (status IN ('new','qualified','converted','dropped')),
  first_msg text,
  last_msg_at timestamptz DEFAULT now(),
  program_interest text,
  market text DEFAULT 'IN' CHECK (market IN ('IN','UAE','UK','GLOBAL')),
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS leads_phone_idx ON leads(phone);

CREATE TABLE IF NOT EXISTS clients (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid REFERENCES leads(id),
  phone text NOT NULL,
  name text,
  email text,
  program text CHECK (program IN ('6wk_gym','6wk_home','12wk','pcos','40plus','zoom_trial','zoom_pack')),
  program_started_at timestamptz DEFAULT now(),
  program_ends_at timestamptz,
  paid_amount integer DEFAULT 0,
  checkout_id text,
  folder_url text,
  status text DEFAULT 'active' CHECK (status IN ('active','paused','completed','refunded')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clients_phone_idx ON clients(phone);
CREATE INDEX IF NOT EXISTS clients_status_idx ON clients(status);

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
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checkins_client_week_idx ON checkins(client_id, week_no);

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
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS programs_client_week_idx ON programs(client_id, week_no);

CREATE TABLE IF NOT EXISTS messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  body text,
  template_name text,
  sent_at timestamptz DEFAULT now(),
  status text DEFAULT 'sent'
);

CREATE INDEX IF NOT EXISTS messages_phone_idx ON messages(phone);
CREATE INDEX IF NOT EXISTS messages_sent_at_idx ON messages(sent_at);

-- Row Level Security
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS, so API functions work fine.
-- For admin dashboard, create a policy for authenticated users:
CREATE POLICY "Admin read all leads" ON leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin read all clients" ON clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin read all checkins" ON checkins FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin read all programs" ON programs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin read all messages" ON messages FOR SELECT TO authenticated USING (true);
