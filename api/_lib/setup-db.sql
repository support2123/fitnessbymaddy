-- Supabase SQL: Run this in the Supabase SQL Editor to create all tables

CREATE TABLE IF NOT EXISTS leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  name TEXT,
  source TEXT DEFAULT 'whatsapp',
  status TEXT DEFAULT 'new' CHECK (status IN ('new','qualified','converted','dropped')),
  first_msg TEXT,
  last_msg_at TIMESTAMPTZ DEFAULT NOW(),
  program_interest TEXT,
  market TEXT DEFAULT 'GLOBAL' CHECK (market IN ('IN','UAE','UK','GLOBAL')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS leads_phone_idx ON leads(phone);

CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  program TEXT CHECK (program IN ('6wk_gym','6wk_home','12wk','pcos','40plus','zoom_trial','zoom_pack')),
  program_started_at TIMESTAMPTZ DEFAULT NOW(),
  program_ends_at TIMESTAMPTZ,
  paid_amount INTEGER DEFAULT 0,
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','paused','completed','refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT NOW(),
  weight NUMERIC,
  waist NUMERIC,
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT,
  photos_urls JSONB DEFAULT '[]'::jsonb,
  next_week_focus TEXT
);

CREATE TABLE IF NOT EXISTS programs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB,
  nutrition_plan JSONB,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent'
);

CREATE INDEX IF NOT EXISTS messages_phone_idx ON messages(phone, sent_at DESC);
CREATE INDEX IF NOT EXISTS clients_status_idx ON clients(status);
CREATE INDEX IF NOT EXISTS checkins_client_idx ON checkins(client_id, week_no DESC);
