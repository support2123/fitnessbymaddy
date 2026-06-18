-- ============================================================
-- FitnessByMaddy  -  Supabase Schema
-- Run once:  psql $DATABASE_URL -f sql/schema.sql
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. LEADS
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           text        NOT NULL,
  name            text,
  source          text,
  status          text        NOT NULL DEFAULT 'new'
                              CHECK (status IN ('new', 'qualified', 'intake_done', 'converted', 'dropped')),
  first_msg       text,
  profile         jsonb,
  last_msg_at     timestamptz,
  program_interest text,
  market          text        CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_phone      ON leads (phone);
CREATE INDEX IF NOT EXISTS idx_leads_status     ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at DESC);

-- ============================================================
-- 2. CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid        REFERENCES leads(id) ON DELETE SET NULL,
  phone             text        NOT NULL,
  name              text,
  email             text,
  program           text        CHECK (program IN (
                                  '6wk_gym', '6wk_home', '12wk',
                                  'pcos', '40plus', 'zoom_trial', 'zoom_pack'
                                )),
  program_started_at timestamptz,
  program_ends_at    timestamptz,
  paid_amount       integer,
  checkout_id       text,
  folder_url        text,
  status            text        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_phone    ON clients (phone);
CREATE INDEX IF NOT EXISTS idx_clients_lead_id  ON clients (lead_id);
CREATE INDEX IF NOT EXISTS idx_clients_status   ON clients (status);

-- ============================================================
-- 3. CHECK-INS
-- ============================================================
CREATE TABLE IF NOT EXISTS checkins (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_no           integer     NOT NULL,
  form_submitted_at timestamptz NOT NULL DEFAULT now(),
  weight            numeric,
  waist             numeric,
  compliance_score  integer     CHECK (compliance_score BETWEEN 1 AND 10),
  energy            integer     CHECK (energy BETWEEN 1 AND 10),
  issues            text,
  photos_urls       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  next_week_focus   text,

  UNIQUE (client_id, week_no)
);

CREATE INDEX IF NOT EXISTS idx_checkins_client_id ON checkins (client_id);

-- ============================================================
-- 4. PROGRAMS  (weekly plan deliveries)
-- ============================================================
CREATE TABLE IF NOT EXISTS programs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  week_no           integer,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  pdf_url           text,
  whatsapp_sent_at  timestamptz,
  workout_plan      jsonb,
  nutrition_plan    jsonb,
  notes             text,

  UNIQUE (client_id, week_no)
);

CREATE INDEX IF NOT EXISTS idx_programs_client_id ON programs (client_id);

-- ============================================================
-- 5. MESSAGES  (WhatsApp message log)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text        NOT NULL,
  direction     text        NOT NULL CHECK (direction IN ('in', 'out')),
  body          text,
  template_name text,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  status        text
);

CREATE INDEX IF NOT EXISTS idx_messages_phone   ON messages (phone);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages (sent_at DESC);

-- ============================================================
-- 6. ROW-LEVEL SECURITY (RLS)
-- ============================================================
-- Enable RLS on every table.  The service-role key bypasses RLS,
-- so serverless functions keep full access.  If a future client-side
-- Supabase call is added, add per-table SELECT/INSERT policies here.

ALTER TABLE leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Service-role bypass policies  (service_role can do everything)
CREATE POLICY "service_role_all" ON leads    FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON clients  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON checkins FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON programs FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_role_all" ON messages FOR ALL USING (auth.role() = 'service_role');

-- Anon / authenticated users: read-only on their own rows via phone claim
-- (extend these policies later when client-facing features are added)
