-- FitnessByMaddy Automation Pipeline — Supabase Schema
-- Run this in the Supabase SQL editor to bootstrap all tables.

-- Leads table: every new WhatsApp contact
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  source TEXT DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','qualified','converted','dropped')),
  first_msg TEXT,
  last_msg_at TIMESTAMPTZ DEFAULT now(),
  program_interest TEXT,
  market TEXT DEFAULT 'GLOBAL' CHECK (market IN ('IN','UAE','UK','GLOBAL')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_phone ON leads(phone);

-- Clients table: paid / active clients
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  program TEXT NOT NULL CHECK (program IN (
    '6wk_gym','6wk_home','12wk','pcos','40plus','zoom_trial','zoom_pack'
  )),
  program_started_at TIMESTAMPTZ DEFAULT now(),
  program_ends_at TIMESTAMPTZ,
  paid_amount INTEGER DEFAULT 0,
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','refunded')),
  age INTEGER,
  goal TEXT,
  injuries TEXT,
  diet_pref TEXT,
  schedule TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_phone ON clients(phone);

-- Weekly check-ins
CREATE TABLE IF NOT EXISTS checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT now(),
  weight NUMERIC,
  waist NUMERIC,
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT,
  photos_urls TEXT[] DEFAULT '{}',
  next_week_focus TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, week_no)
);

CREATE INDEX idx_checkins_client ON checkins(client_id);

-- Generated programs (weekly, for 12-week clients)
CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT now(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB,
  nutrition_plan JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, week_no)
);

CREATE INDEX idx_programs_client ON programs(client_id);

-- Message audit trail
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'sent'
);

CREATE INDEX idx_messages_phone ON messages(phone);
CREATE INDEX idx_messages_sent ON messages(sent_at);

-- Escalations queue
CREATE TABLE IF NOT EXISTS escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  reason TEXT NOT NULL,
  message_body TEXT,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_escalations_resolved ON escalations(resolved);

-- Enable Row Level Security (policies configured via Supabase dashboard)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;

-- Service-role bypass policies (API uses service key)
CREATE POLICY "service_all_leads" ON leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_clients" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_checkins" ON checkins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_programs" ON programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_messages" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all_escalations" ON escalations FOR ALL USING (true) WITH CHECK (true);

-- Storage bucket for client files (PDFs, photos)
-- Run via Supabase dashboard: create bucket "clients" with public access disabled
