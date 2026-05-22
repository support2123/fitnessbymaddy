-- FitnessByMaddy Automation Pipeline — Supabase Schema
-- Run this in the Supabase SQL Editor to bootstrap all tables.

-- LEADS: every new WhatsApp contact
CREATE TABLE IF NOT EXISTS leads (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone         TEXT NOT NULL UNIQUE,
  name          TEXT,
  source        TEXT DEFAULT 'whatsapp',
  status        TEXT DEFAULT 'new' CHECK (status IN ('new','qualified','converted','dropped')),
  first_msg     TEXT,
  last_msg_at   TIMESTAMPTZ DEFAULT now(),
  program_interest TEXT,
  market        TEXT DEFAULT 'IN' CHECK (market IN ('IN','UAE','UK','GLOBAL')),
  intake_data   JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- CLIENTS: converted leads with active programs
CREATE TABLE IF NOT EXISTS clients (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id         UUID REFERENCES leads(id),
  phone           TEXT NOT NULL,
  name            TEXT,
  email           TEXT,
  program         TEXT CHECK (program IN (
    '6wk_gym','6wk_home','12wk','pcos','40plus','zoom_trial','zoom_pack'
  )),
  program_started_at TIMESTAMPTZ DEFAULT now(),
  program_ends_at    TIMESTAMPTZ,
  paid_amount     INTEGER DEFAULT 0,
  checkout_id     TEXT,
  folder_url      TEXT,
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','paused','completed','refunded')),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- CHECK-INS: weekly progress reports from clients
CREATE TABLE IF NOT EXISTS checkins (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id         UUID REFERENCES clients(id) NOT NULL,
  week_no           INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT now(),
  weight            DECIMAL,
  waist             DECIMAL,
  compliance_score  INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy            INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues            TEXT,
  photos_urls       JSONB DEFAULT '[]',
  next_week_focus   TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, week_no)
);

-- PROGRAMS: weekly generated plans (12-week clients)
CREATE TABLE IF NOT EXISTS programs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id       UUID REFERENCES clients(id) NOT NULL,
  week_no         INTEGER NOT NULL,
  generated_at    TIMESTAMPTZ DEFAULT now(),
  pdf_url         TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan    JSONB,
  nutrition_plan  JSONB,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, week_no)
);

-- MESSAGES: audit trail for all WhatsApp messages
CREATE TABLE IF NOT EXISTS messages (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone         TEXT NOT NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('in','out')),
  body          TEXT,
  template_name TEXT,
  sent_at       TIMESTAMPTZ DEFAULT now(),
  status        TEXT DEFAULT 'sent'
);

-- INDEXES for common queries
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins(client_id);
CREATE INDEX IF NOT EXISTS idx_programs_client ON programs(client_id);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at);

-- ROW LEVEL SECURITY (enable after setting up auth)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Service role bypass (for API calls with service key)
CREATE POLICY "Service role full access" ON leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON checkins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON messages FOR ALL USING (true) WITH CHECK (true);
