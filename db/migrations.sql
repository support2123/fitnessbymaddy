-- FitnessByMaddy Automation Pipeline — Supabase Schema
-- Run this in the Supabase SQL editor to create all tables

-- ============================================================
-- LEADS
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone         text NOT NULL,
  name          text,
  source        text DEFAULT 'whatsapp',
  status        text NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new','qualified','converted','dropped')),
  first_msg     text,
  last_msg_at   timestamptz,
  program_interest text,
  market        text DEFAULT 'GLOBAL'
                  CHECK (market IN ('IN','UAE','UK','GLOBAL')),
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT uq_leads_phone UNIQUE (phone)
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at);

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id           uuid REFERENCES leads(id),
  phone             text NOT NULL,
  name              text,
  email             text,
  program           text NOT NULL
                      CHECK (program IN (
                        '6wk_gym','6wk_home','12wk','pcos','40plus',
                        'zoom_trial','zoom_pack'
                      )),
  program_started_at timestamptz DEFAULT now(),
  program_ends_at   timestamptz,
  paid_amount       integer,  -- in USD cents
  checkout_id       text,
  folder_url        text,
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','paused','completed','refunded')),
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_status ON clients (status);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients (phone);

-- ============================================================
-- CHECKINS (weekly)
-- ============================================================
CREATE TABLE IF NOT EXISTS checkins (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id         uuid NOT NULL REFERENCES clients(id),
  week_no           integer NOT NULL,
  form_submitted_at timestamptz DEFAULT now(),
  weight            numeric(5,1),
  waist             numeric(5,1),
  compliance_score  integer CHECK (compliance_score BETWEEN 1 AND 10),
  energy            integer CHECK (energy BETWEEN 1 AND 10),
  issues            text,
  photos_urls       text[] DEFAULT '{}',
  next_week_focus   text,
  created_at        timestamptz DEFAULT now(),
  CONSTRAINT uq_checkin_client_week UNIQUE (client_id, week_no)
);

CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins (client_id);

-- ============================================================
-- PROGRAMS (generated weekly per client)
-- ============================================================
CREATE TABLE IF NOT EXISTS programs (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id         uuid NOT NULL REFERENCES clients(id),
  week_no           integer NOT NULL,
  generated_at      timestamptz DEFAULT now(),
  pdf_url           text,
  whatsapp_sent_at  timestamptz,
  workout_plan      jsonb,
  nutrition_plan    jsonb,
  notes             text,
  created_at        timestamptz DEFAULT now(),
  CONSTRAINT uq_program_client_week UNIQUE (client_id, week_no)
);

CREATE INDEX IF NOT EXISTS idx_programs_client ON programs (client_id);

-- ============================================================
-- MESSAGES (audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  phone           text NOT NULL,
  direction       text NOT NULL CHECK (direction IN ('in','out')),
  body            text,
  template_name   text,
  sent_at         timestamptz DEFAULT now(),
  status          text DEFAULT 'sent',
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages (phone);
CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages (sent_at);

-- ============================================================
-- INTAKE FORMS (extended onboarding data)
-- ============================================================
CREATE TABLE IF NOT EXISTS intake_forms (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id         uuid REFERENCES leads(id),
  phone           text,
  name            text,
  age             integer,
  gender          text,
  goal            text,
  injuries        text,
  medical         text,
  diet_preference text,
  schedule        text,
  experience      text,
  submitted_at    timestamptz DEFAULT now()
);

-- ============================================================
-- ROW LEVEL SECURITY (service key bypasses — enable for future)
-- ============================================================
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_forms ENABLE ROW LEVEL SECURITY;

-- Service role policy (allows full access for backend)
DO $$ BEGIN
  EXECUTE format(
    'CREATE POLICY service_all ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)',
    unnest(ARRAY['leads','clients','checkins','programs','messages','intake_forms'])
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
