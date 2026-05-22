-- FitnessByMaddy Automation Pipeline — Supabase Schema
-- Run this in the Supabase SQL Editor to set up all tables

-- Leads table: every new WhatsApp contact
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  name text,
  source text DEFAULT 'whatsapp',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','qualified','converted','dropped')),
  first_msg text,
  last_msg_at timestamptz DEFAULT now(),
  program_interest text,
  market text DEFAULT 'IN' CHECK (market IN ('IN','UAE','UK','GLOBAL')),
  created_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS leads_phone_idx ON leads (phone);

-- Clients table: paid/converted users
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id),
  phone text NOT NULL,
  name text,
  email text,
  program text NOT NULL CHECK (program IN (
    '6wk_gym','6wk_home','12wk','pcos','40plus','zoom_trial','zoom_pack'
  )),
  program_started_at timestamptz DEFAULT now(),
  program_ends_at timestamptz,
  paid_amount integer DEFAULT 0,
  checkout_id text,
  folder_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','refunded')),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clients_phone_idx ON clients (phone);
CREATE INDEX IF NOT EXISTS clients_status_idx ON clients (status);

-- Weekly check-ins
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
  photos_urls text[] DEFAULT '{}',
  next_week_focus text
);
CREATE INDEX IF NOT EXISTS checkins_client_week_idx ON checkins (client_id, week_no);

-- Generated programs (weekly for 12wk clients)
CREATE TABLE IF NOT EXISTS programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  week_no integer NOT NULL,
  generated_at timestamptz DEFAULT now(),
  pdf_url text,
  whatsapp_sent_at timestamptz,
  workout_plan jsonb DEFAULT '{}',
  nutrition_plan jsonb DEFAULT '{}',
  notes text
);
CREATE INDEX IF NOT EXISTS programs_client_week_idx ON programs (client_id, week_no);

-- Message audit trail
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  body text,
  template_name text,
  sent_at timestamptz DEFAULT now(),
  status text DEFAULT 'sent'
);
CREATE INDEX IF NOT EXISTS messages_phone_idx ON messages (phone);
CREATE INDEX IF NOT EXISTS messages_sent_at_idx ON messages (sent_at);

-- Intake form submissions (stored before conversion)
CREATE TABLE IF NOT EXISTS intake_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id),
  age integer,
  gender text,
  height_cm numeric,
  current_weight numeric,
  goal_weight numeric,
  primary_goal text,
  injuries text,
  medical_conditions text,
  diet_preference text,
  meals_per_day integer,
  workout_days_per_week integer,
  equipment_access text,
  wake_time text,
  sleep_time text,
  submitted_at timestamptz DEFAULT now()
);

-- Escalation queue
CREATE TABLE IF NOT EXISTS escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  client_id uuid REFERENCES clients(id),
  reason text NOT NULL,
  message_body text,
  resolved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS escalations_resolved_idx ON escalations (resolved);

-- Row Level Security policies
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by serverless functions)
CREATE POLICY "Service role full access" ON leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON checkins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON intake_submissions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON escalations FOR ALL USING (true) WITH CHECK (true);
