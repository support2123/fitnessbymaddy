-- FitnessByMaddy automation pipeline — Supabase schema
-- Run this in the Supabase SQL Editor to bootstrap all tables.

-- ════════════════════════════════════════════
-- LEADS
-- ════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS leads (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone       TEXT NOT NULL UNIQUE,
  name        TEXT,
  source      TEXT DEFAULT 'whatsapp',
  status      TEXT NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','qualified','converted','dropped')),
  first_msg   TEXT,
  last_msg_at TIMESTAMPTZ DEFAULT now(),
  program_interest TEXT,
  market      TEXT DEFAULT 'GLOBAL'
                CHECK (market IN ('IN','UAE','UK','GLOBAL')),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ════════════════════════════════════════════
-- CLIENTS
-- ════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS clients (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id           UUID REFERENCES leads(id),
  phone             TEXT NOT NULL,
  name              TEXT,
  email             TEXT,
  program           TEXT NOT NULL
                      CHECK (program IN (
                        '6wk_gym','6wk_home','12wk','pcos',
                        '40plus','zoom_trial','zoom_pack'
                      )),
  program_started_at TIMESTAMPTZ DEFAULT now(),
  program_ends_at    TIMESTAMPTZ,
  paid_amount        INTEGER,
  checkout_id        TEXT,
  folder_url         TEXT,
  status             TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','paused','completed','refunded')),
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- ════════════════════════════════════════════
-- WEEKLY CHECK-INS
-- ════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS checkins (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id         UUID NOT NULL REFERENCES clients(id),
  week_no           INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT now(),
  weight            NUMERIC,
  waist             NUMERIC,
  compliance_score  INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy            INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues            TEXT,
  photos_urls       JSONB DEFAULT '[]'::jsonb,
  next_week_focus   TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, week_no)
);

-- ════════════════════════════════════════════
-- GENERATED PROGRAMS (weekly per client)
-- ════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS programs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id       UUID NOT NULL REFERENCES clients(id),
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

-- ════════════════════════════════════════════
-- MESSAGE AUDIT TRAIL
-- ════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS messages (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone         TEXT NOT NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('in','out')),
  body          TEXT,
  template_name TEXT,
  sent_at       TIMESTAMPTZ DEFAULT now(),
  status        TEXT DEFAULT 'sent'
);

-- ════════════════════════════════════════════
-- INDEXES
-- ════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_leads_phone      ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status     ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created    ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_clients_phone    ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status   ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_lead     ON clients(lead_id);
CREATE INDEX IF NOT EXISTS idx_checkins_client  ON checkins(client_id);
CREATE INDEX IF NOT EXISTS idx_programs_client  ON programs(client_id);
CREATE INDEX IF NOT EXISTS idx_messages_phone   ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_messages_sent    ON messages(sent_at);

-- ════════════════════════════════════════════
-- ROW-LEVEL SECURITY
-- ════════════════════════════════════════════
ALTER TABLE leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Allow full access via the service-role key (used by API)
CREATE POLICY "service_role_leads"    ON leads    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_clients"  ON clients  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_checkins" ON checkins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_programs" ON programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_messages" ON messages FOR ALL USING (true) WITH CHECK (true);
