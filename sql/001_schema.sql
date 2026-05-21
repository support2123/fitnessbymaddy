-- FitnessByMaddy automation schema
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  name TEXT,
  source TEXT DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
  first_msg TEXT,
  last_msg_at TIMESTAMPTZ DEFAULT now(),
  program_interest TEXT,
  market TEXT DEFAULT 'GLOBAL' CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(phone)
);

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  program TEXT CHECK (program IN ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at TIMESTAMPTZ DEFAULT now(),
  program_ends_at TIMESTAMPTZ,
  paid_amount INTEGER,
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(phone)
);

CREATE TABLE IF NOT EXISTS checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT now(),
  weight NUMERIC,
  waist NUMERIC,
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT,
  photos_urls JSONB DEFAULT '[]',
  next_week_focus TEXT
);

CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT now(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB,
  nutrition_plan JSONB,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'sent'
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins(client_id, week_no);
CREATE INDEX IF NOT EXISTS idx_programs_client ON programs(client_id, week_no);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone, sent_at);

-- Intake form data (extended client profile)
CREATE TABLE IF NOT EXISTS intake_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id),
  client_id UUID REFERENCES clients(id),
  age INTEGER,
  gender TEXT,
  height_cm NUMERIC,
  weight_kg NUMERIC,
  goal TEXT,
  injuries TEXT,
  medical_conditions TEXT,
  diet_preference TEXT,
  meals_per_day INTEGER,
  workout_days_per_week INTEGER,
  gym_access BOOLEAN DEFAULT true,
  equipment_available TEXT,
  wake_time TEXT,
  sleep_time TEXT,
  occupation TEXT,
  stress_level INTEGER CHECK (stress_level BETWEEN 1 AND 10),
  photos_urls JSONB DEFAULT '[]',
  submitted_at TIMESTAMPTZ DEFAULT now()
);

-- RLS policies (enable RLS, then service key bypasses)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_forms ENABLE ROW LEVEL SECURITY;

-- Storage bucket for client files
INSERT INTO storage.buckets (id, name, public) VALUES ('clients', 'clients', false)
ON CONFLICT (id) DO NOTHING;
