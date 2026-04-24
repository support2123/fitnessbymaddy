-- FitnessByMaddy Automation Schema
-- Run this in your Supabase SQL Editor

-- Leads table
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  name TEXT,
  source TEXT DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
  first_msg TEXT,
  last_msg_at TIMESTAMPTZ DEFAULT NOW(),
  program_interest TEXT,
  market TEXT DEFAULT 'GLOBAL' CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

-- Clients table
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  program TEXT NOT NULL CHECK (program IN ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at TIMESTAMPTZ DEFAULT NOW(),
  program_ends_at TIMESTAMPTZ,
  paid_amount INTEGER DEFAULT 0,
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- Check-ins table (weekly)
CREATE TABLE IF NOT EXISTS checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT NOW(),
  weight NUMERIC,
  waist NUMERIC,
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT,
  photos_urls TEXT[] DEFAULT '{}',
  next_week_focus TEXT
);

CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins(client_id, week_no);

-- Programs table (generated weekly per client)
CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB,
  nutrition_plan JSONB,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_programs_client ON programs(client_id, week_no);

-- Messages audit trail
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent'
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone, sent_at DESC);

-- Intake forms (stores onboarding data)
CREATE TABLE IF NOT EXISTS intake_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id),
  age INTEGER,
  gender TEXT,
  height_cm NUMERIC,
  current_weight NUMERIC,
  goal_weight NUMERIC,
  goal TEXT,
  injuries TEXT,
  medical_conditions TEXT,
  diet_preference TEXT,
  meals_per_day INTEGER,
  workout_experience TEXT,
  days_available INTEGER,
  equipment_access TEXT,
  wake_time TEXT,
  sleep_time TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Nudge tracking (prevent double-nudging)
CREATE TABLE IF NOT EXISTS nudge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id),
  nudge_type TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nudge_lead ON nudge_log(lead_id, nudge_type);

-- Enable Row Level Security (admin-only access via service key)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE nudge_log ENABLE ROW LEVEL SECURITY;
