-- =============================================================
-- Fitness by Maddy – Supabase PostgreSQL Schema
-- WhatsApp coaching pipeline: leads → clients → checkins → programs
-- =============================================================

-- ---------- leads ----------
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  source TEXT DEFAULT 'whatsapp',
  status TEXT DEFAULT 'new'
    CHECK (status IN ('new','qualified','converted','dropped')),
  first_msg TEXT,
  last_msg_at TIMESTAMPTZ,
  program_interest TEXT,
  market TEXT DEFAULT 'GLOBAL'
    CHECK (market IN ('IN','UAE','UK','GLOBAL')),
  age INTEGER,
  goal TEXT,
  injuries TEXT,
  diet_pref TEXT,
  schedule TEXT,
  intake_completed BOOLEAN DEFAULT FALSE,
  reply_received BOOLEAN DEFAULT FALSE,
  nudge_at TIMESTAMPTZ,
  dropped_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(phone)
);

-- ---------- clients ----------
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  gender TEXT,
  age INTEGER,
  height_cm NUMERIC,
  weight_kg NUMERIC,
  program TEXT
    CHECK (program IN (
      '6wk','6wk_gym','6wk_home','12wk','pcos','40plus',
      'zoom_trial','zoom_pack','trial','unknown'
    )),
  program_type TEXT,
  goals TEXT,
  dietary_preferences TEXT,
  injuries_limitations TEXT,
  experience_level TEXT,
  equipment_access TEXT,
  program_started_at TIMESTAMPTZ DEFAULT NOW(),
  program_ends_at TIMESTAMPTZ,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  paid_amount INTEGER,
  amount INTEGER,
  checkout_id TEXT,
  folder_url TEXT,
  market TEXT,
  status TEXT DEFAULT 'active'
    CHECK (status IN ('active','paused','completed','refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(phone)
);

-- ---------- checkins ----------
CREATE TABLE IF NOT EXISTS checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  weight NUMERIC,
  waist NUMERIC,
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT,
  photos_urls TEXT[],
  photos TEXT[],
  next_week_focus TEXT,
  UNIQUE(client_id, week_no)
);

-- ---------- programs ----------
CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) NOT NULL,
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB,
  nutrition_plan JSONB,
  notes TEXT,
  status TEXT DEFAULT 'sent',
  flagged_for_review BOOLEAN DEFAULT FALSE,
  safety_issues TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, week_no)
);

-- ---------- messages ----------
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent'
);

-- =============================================================
-- Indexes
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_leads_phone   ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status  ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);

CREATE INDEX IF NOT EXISTS idx_clients_phone  ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_lead   ON clients(lead_id);

CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins(client_id);
CREATE INDEX IF NOT EXISTS idx_checkins_week   ON checkins(client_id, week_no);

CREATE INDEX IF NOT EXISTS idx_programs_client  ON programs(client_id);
CREATE INDEX IF NOT EXISTS idx_programs_flagged ON programs(flagged_for_review)
  WHERE flagged_for_review = TRUE;

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_messages_sent  ON messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_messages_dir   ON messages(direction);

-- =============================================================
-- Row-Level Security
-- =============================================================
ALTER TABLE leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_leads_all" ON leads
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "admin_leads_select" ON leads
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND auth.jwt() ->> 'email' = 'support@fitnessbymaddy.com'
  );

CREATE POLICY "service_role_clients_all" ON clients
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "admin_clients_select" ON clients
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND auth.jwt() ->> 'email' = 'support@fitnessbymaddy.com'
  );

CREATE POLICY "service_role_checkins_all" ON checkins
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "admin_checkins_select" ON checkins
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND auth.jwt() ->> 'email' = 'support@fitnessbymaddy.com'
  );

CREATE POLICY "service_role_programs_all" ON programs
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "admin_programs_select" ON programs
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND auth.jwt() ->> 'email' = 'support@fitnessbymaddy.com'
  );

CREATE POLICY "service_role_messages_all" ON messages
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "admin_messages_select" ON messages
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND auth.jwt() ->> 'email' = 'support@fitnessbymaddy.com'
  );

-- =============================================================
-- Supabase Storage Buckets (run in dashboard or via API)
-- =============================================================
-- CREATE BUCKET IF NOT EXISTS: checkin-photos (public)
-- CREATE BUCKET IF NOT EXISTS: programs (public)
