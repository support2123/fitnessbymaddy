-- FitnessByMaddy — Full Database Schema
-- Run in Supabase SQL Editor to create all tables

-- ════════════════════════════════════════════
-- LEADS
-- ════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  name TEXT,
  source TEXT DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
  first_msg TEXT,
  last_msg_at TIMESTAMPTZ,
  program_interest TEXT,
  market TEXT DEFAULT 'GLOBAL'
    CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (phone)
);

CREATE INDEX idx_leads_status ON leads (status);
CREATE INDEX idx_leads_phone ON leads (phone);
CREATE INDEX idx_leads_created ON leads (created_at DESC);

-- ════════════════════════════════════════════
-- CLIENTS
-- ════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  program TEXT NOT NULL
    CHECK (program IN ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at TIMESTAMPTZ,
  program_ends_at TIMESTAMPTZ,
  paid_amount INTEGER, -- cents
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (phone, program)
);

CREATE INDEX idx_clients_status ON clients (status);
CREATE INDEX idx_clients_phone ON clients (phone);

-- ════════════════════════════════════════════
-- CHECK-INS (weekly)
-- ════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT NOW(),
  weight NUMERIC(5,1),
  waist NUMERIC(5,1),
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT,
  photos_urls TEXT[] DEFAULT '{}',
  next_week_focus TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, week_no)
);

CREATE INDEX idx_checkins_client ON checkins (client_id, week_no DESC);

-- ════════════════════════════════════════════
-- PROGRAMS (generated weekly per client)
-- ════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS programs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB,
  nutrition_plan JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (client_id, week_no)
);

CREATE INDEX idx_programs_client ON programs (client_id, week_no DESC);

-- ════════════════════════════════════════════
-- MESSAGES (audit trail)
-- ════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_phone ON messages (phone, sent_at DESC);
CREATE INDEX idx_messages_direction ON messages (direction, sent_at DESC);

-- ════════════════════════════════════════════
-- INTAKE FORM SUBMISSIONS
-- ════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS intake_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  phone TEXT,
  name TEXT,
  email TEXT,
  age INTEGER,
  gender TEXT,
  height_cm NUMERIC(5,1),
  current_weight NUMERIC(5,1),
  goal_weight NUMERIC(5,1),
  goal TEXT,
  injuries TEXT,
  medical_conditions TEXT,
  diet_preference TEXT,
  meals_per_day INTEGER,
  workout_experience TEXT,
  available_days TEXT[],
  gym_or_home TEXT,
  wake_time TEXT,
  sleep_time TEXT,
  photos_urls TEXT[] DEFAULT '{}',
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════
-- ESCALATIONS
-- ════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS escalations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  reason TEXT NOT NULL,
  context TEXT,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_escalations_resolved ON escalations (resolved, created_at DESC);

-- ════════════════════════════════════════════
-- ROW LEVEL SECURITY (basic — service key bypasses)
-- ════════════════════════════════════════════
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;
