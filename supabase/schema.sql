-- =============================================================================
-- FitnessByMaddy — WhatsApp Fitness Coaching Automation Pipeline
-- Database Schema
-- =============================================================================
-- All access is via the service_role key (backend only).
-- No anon policies are defined. RLS is enabled on all tables.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ---------------------------------------------------------------------------
-- updated_at trigger function
-- Automatically sets updated_at = now() on any UPDATE.
-- Applied to: leads, clients
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- TABLE: leads
-- Prospective clients captured from WhatsApp (or other sources).
-- =============================================================================
CREATE TABLE IF NOT EXISTS leads (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           text          NOT NULL UNIQUE,
  name            text,
  source          text          NOT NULL DEFAULT 'whatsapp',
  status          text          NOT NULL DEFAULT 'new'
                                  CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
  first_msg       text,
  last_msg_at     timestamptz,
  program_interest text,
  market          text          NOT NULL DEFAULT 'GLOBAL'
                                  CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now()
);

-- Trigger: keep updated_at current on leads
CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes for common lookup / filter patterns
CREATE INDEX IF NOT EXISTS idx_leads_phone  ON leads (phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);

-- RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- service_role bypass: Supabase grants service_role BYPASSRLS by default,
-- but we add an explicit policy as documentation and belt-and-suspenders.
CREATE POLICY "service_role_full_access" ON leads
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- TABLE: clients
-- Paying / enrolled clients converted from leads.
-- =============================================================================
CREATE TABLE IF NOT EXISTS clients (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid        REFERENCES leads (id) ON DELETE SET NULL,
  phone             text        NOT NULL,
  name              text,
  email             text,
  program           text        CHECK (program IN (
                                  '6wk_gym', '6wk_home', '12wk',
                                  'pcos', '40plus', 'zoom_trial', 'zoom_pack'
                                )),
  program_started_at timestamptz,
  program_ends_at   timestamptz,
  paid_amount       integer,    -- stored in smallest currency unit (paise / fils / pence / cents)
  checkout_id       text,
  folder_url        text,
  status            text        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Trigger: keep updated_at current on clients
CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clients_phone   ON clients (phone);
CREATE INDEX IF NOT EXISTS idx_clients_status  ON clients (status);
CREATE INDEX IF NOT EXISTS idx_clients_lead_id ON clients (lead_id);

-- RLS
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON clients
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- TABLE: checkins
-- Weekly progress check-ins submitted by clients.
-- =============================================================================
CREATE TABLE IF NOT EXISTS checkins (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  week_no           integer     NOT NULL,
  form_submitted_at timestamptz NOT NULL DEFAULT now(),
  weight            numeric,    -- in kg
  waist             numeric,    -- in cm
  compliance_score  integer     CHECK (compliance_score BETWEEN 1 AND 10),
  energy            integer     CHECK (energy BETWEEN 1 AND 10),
  issues            text,
  photos_urls       text[]      NOT NULL DEFAULT '{}',
  next_week_focus   text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Composite index: look up a client's check-ins by week
CREATE INDEX IF NOT EXISTS idx_checkins_client_week ON checkins (client_id, week_no);

-- RLS
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON checkins
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- TABLE: programs
-- Weekly workout / nutrition plans generated for clients.
-- =============================================================================
CREATE TABLE IF NOT EXISTS programs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid        NOT NULL REFERENCES clients (id) ON DELETE CASCADE,
  week_no          integer     NOT NULL,
  generated_at     timestamptz NOT NULL DEFAULT now(),
  pdf_url          text,
  whatsapp_sent_at timestamptz,
  workout_plan     jsonb,
  nutrition_plan   jsonb,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Composite index: look up a client's program by week
CREATE INDEX IF NOT EXISTS idx_programs_client_week ON programs (client_id, week_no);

-- RLS
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON programs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- TABLE: messages
-- Full log of inbound and outbound WhatsApp messages.
-- =============================================================================
CREATE TABLE IF NOT EXISTS messages (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text        NOT NULL,
  direction     text        NOT NULL CHECK (direction IN ('in', 'out')),
  body          text,
  template_name text,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  status        text        NOT NULL DEFAULT 'sent',
  metadata      jsonb       NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Composite index: timeline queries per phone number
CREATE INDEX IF NOT EXISTS idx_messages_phone_sent_at ON messages (phone, sent_at);

-- RLS
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- TABLE: escalations
-- Flags conversations that require human (Maddy) intervention.
-- =============================================================================
CREATE TABLE IF NOT EXISTS escalations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           text        NOT NULL,
  client_id       uuid        REFERENCES clients (id) ON DELETE SET NULL, -- nullable
  trigger_type    text        NOT NULL,
  trigger_message text,
  resolved        boolean     NOT NULL DEFAULT false,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Index: quickly surface unresolved escalations
CREATE INDEX IF NOT EXISTS idx_escalations_resolved ON escalations (resolved);

-- RLS
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON escalations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- End of schema
-- =============================================================================
