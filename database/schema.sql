-- FitnessByMaddy Automation Pipeline — Supabase Schema
-- Run this in the Supabase SQL Editor to create all tables.

-- ============================================================
-- LEADS
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone         TEXT NOT NULL,
  name          TEXT,
  source        TEXT DEFAULT 'whatsapp',
  status        TEXT DEFAULT 'new' CHECK (status IN ('new','qualified','converted','dropped')),
  first_msg     TEXT,
  last_msg_at   TIMESTAMPTZ DEFAULT now(),
  program_interest TEXT,
  market        TEXT DEFAULT 'GLOBAL' CHECK (market IN ('IN','UAE','UK','GLOBAL')),
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS leads_phone_idx ON leads(phone);

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id           UUID REFERENCES leads(id),
  phone             TEXT NOT NULL,
  name              TEXT,
  email             TEXT,
  program           TEXT CHECK (program IN (
    '6wk_gym','6wk_home','12wk','pcos','40plus','zoom_trial','zoom_pack'
  )),
  program_started_at TIMESTAMPTZ,
  program_ends_at    TIMESTAMPTZ,
  paid_amount        INTEGER,
  checkout_id        TEXT,
  folder_url         TEXT,
  status             TEXT DEFAULT 'active' CHECK (status IN ('active','paused','completed','refunded')),
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clients_phone_idx ON clients(phone);
CREATE INDEX IF NOT EXISTS clients_status_idx ON clients(status);

-- ============================================================
-- CHECKINS (weekly)
-- ============================================================
CREATE TABLE IF NOT EXISTS checkins (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id        UUID NOT NULL REFERENCES clients(id),
  week_no          INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT now(),
  weight           NUMERIC(5,1),
  waist            NUMERIC(5,1),
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy           INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues           TEXT,
  photos_urls      TEXT[] DEFAULT '{}',
  next_week_focus  TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checkins_client_week_idx ON checkins(client_id, week_no);

-- ============================================================
-- PROGRAMS (generated weekly per client)
-- ============================================================
CREATE TABLE IF NOT EXISTS programs (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id        UUID NOT NULL REFERENCES clients(id),
  week_no          INTEGER NOT NULL,
  generated_at     TIMESTAMPTZ DEFAULT now(),
  pdf_url          TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan     JSONB,
  nutrition_plan   JSONB,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS programs_client_week_idx ON programs(client_id, week_no);

-- ============================================================
-- MESSAGES (audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone         TEXT NOT NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('in','out')),
  body          TEXT,
  template_name TEXT,
  sent_at       TIMESTAMPTZ DEFAULT now(),
  status        TEXT DEFAULT 'sent'
);

CREATE INDEX IF NOT EXISTS messages_phone_idx ON messages(phone);
CREATE INDEX IF NOT EXISTS messages_sent_at_idx ON messages(sent_at DESC);

-- ============================================================
-- STORAGE BUCKET (for client files & PDFs)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('clients', 'clients', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies (service role bypasses RLS, so these are for dashboard access)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (admin) to read all data
CREATE POLICY "Admin read leads" ON leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin read clients" ON clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin read checkins" ON checkins FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin read programs" ON programs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin read messages" ON messages FOR SELECT TO authenticated USING (true);
