-- FitnessByMaddy automation pipeline — Supabase schema
-- Run this in the Supabase SQL Editor to bootstrap all tables.

-- ============================================================
-- LEADS
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  name        text,
  source      text DEFAULT 'whatsapp',
  status      text NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','qualified','converted','dropped')),
  first_msg   text,
  last_msg_at timestamptz DEFAULT now(),
  program_interest text,
  market      text DEFAULT 'IN'
                CHECK (market IN ('IN','UAE','UK','GLOBAL')),
  created_at  timestamptz DEFAULT now(),
  UNIQUE (phone)
);

CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads (phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status);

-- ============================================================
-- CLIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS clients (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  program_ends_at    timestamptz,
  paid_amount        integer DEFAULT 0,
  checkout_id        text,
  folder_url         text,
  status             text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','paused','completed','refunded')),
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients (phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients (status);

-- ============================================================
-- CHECKINS (weekly)
-- ============================================================
CREATE TABLE IF NOT EXISTS checkins (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
  UNIQUE (client_id, week_no)
);

-- ============================================================
-- PROGRAMS (generated weekly per client)
-- ============================================================
CREATE TABLE IF NOT EXISTS programs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES clients(id),
  week_no         integer NOT NULL,
  generated_at    timestamptz DEFAULT now(),
  pdf_url         text,
  whatsapp_sent_at timestamptz,
  workout_plan    jsonb,
  nutrition_plan  jsonb,
  notes           text,
  UNIQUE (client_id, week_no)
);

-- ============================================================
-- MESSAGES (audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text NOT NULL,
  direction     text NOT NULL CHECK (direction IN ('in','out')),
  body          text,
  template_name text,
  sent_at       timestamptz DEFAULT now(),
  status        text DEFAULT 'sent'
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages (phone);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages (sent_at DESC);

-- ============================================================
-- INTAKE DATA (linked to leads, filled via intake form)
-- ============================================================
CREATE TABLE IF NOT EXISTS intake_data (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid REFERENCES leads(id),
  age         integer,
  gender      text,
  height_cm   numeric(5,1),
  weight_kg   numeric(5,1),
  goal        text,
  injuries    text,
  diet_pref   text,
  schedule    text,
  experience  text,
  medical     text,
  submitted_at timestamptz DEFAULT now()
);

-- ============================================================
-- ROW-LEVEL SECURITY (enable but allow service key full access)
-- ============================================================
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_data ENABLE ROW LEVEL SECURITY;

-- Service-role bypass (Vercel functions use service key)
CREATE POLICY "service_all" ON leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON clients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON checkins FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON programs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_all" ON intake_data FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- STORAGE BUCKET for client files (PDFs, photos)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('clients', 'clients', false)
ON CONFLICT (id) DO NOTHING;
