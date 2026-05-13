-- FitnessByMaddy Supabase Schema
-- Run this in the Supabase SQL Editor to create all tables

CREATE TABLE IF NOT EXISTS leads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  name text,
  source text DEFAULT 'whatsapp',
  status text DEFAULT 'new' CHECK (status IN ('new','qualified','converted','dropped')),
  first_msg text,
  last_msg_at timestamptz DEFAULT now(),
  program_interest text,
  market text DEFAULT 'GLOBAL' CHECK (market IN ('IN','UAE','UK','GLOBAL')),
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS leads_phone_idx ON leads (phone);

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
  next_week_focus text
);

CREATE TABLE IF NOT EXISTS programs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid REFERENCES clients(id) NOT NULL,
  week_no integer NOT NULL,
  generated_at timestamptz DEFAULT now(),
  pdf_url text,
  whatsapp_sent_at timestamptz,
  workout_plan jsonb,
  nutrition_plan jsonb,
  notes text
);

CREATE TABLE IF NOT EXISTS lead_intake (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id uuid REFERENCES leads(id) UNIQUE,
  name text,
  email text,
  phone text,
  age integer,
  gender text,
  height numeric,
  weight numeric,
  goal text,
  injuries text,
  diet_pref text,
  schedule text,
  medical_conditions text,
  experience_level text,
  photos text[] DEFAULT '{}',
  submitted_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  body text,
  template_name text,
  sent_at timestamptz DEFAULT now(),
  status text DEFAULT 'sent'
);

-- Row Level Security (enable on all tables)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Service-role bypass policies (API uses service key)
CREATE POLICY "service_all_leads" ON leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_clients" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_checkins" ON checkins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_programs" ON programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_messages" ON messages FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE lead_intake ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all_lead_intake" ON lead_intake FOR ALL USING (true) WITH CHECK (true);

-- Storage bucket for client files
INSERT INTO storage.buckets (id, name, public) VALUES ('clients', 'clients', false)
ON CONFLICT (id) DO NOTHING;
