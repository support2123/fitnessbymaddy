-- FitnessByMaddy Automation Pipeline — Database Schema
-- Run this in Supabase SQL Editor to set up all tables

-- ═══════════════════════════════════════
-- LEADS
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  name TEXT DEFAULT 'Unknown',
  source TEXT DEFAULT 'whatsapp',
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
  first_msg TEXT,
  last_msg_at TIMESTAMPTZ,
  program_interest TEXT,
  market TEXT DEFAULT 'GLOBAL' CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);

-- ═══════════════════════════════════════
-- CLIENTS
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  program TEXT CHECK (program IN ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at TIMESTAMPTZ,
  program_ends_at TIMESTAMPTZ,
  paid_amount NUMERIC(10,2),
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_lead ON clients(lead_id);

-- ═══════════════════════════════════════
-- CHECKINS (weekly)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  form_submitted_at TIMESTAMPTZ DEFAULT NOW(),
  weight NUMERIC(5,1),
  waist NUMERIC(5,1),
  compliance_score INTEGER CHECK (compliance_score BETWEEN 1 AND 10),
  energy INTEGER CHECK (energy BETWEEN 1 AND 10),
  issues TEXT,
  photos_urls JSONB DEFAULT '[]',
  next_week_focus TEXT,
  UNIQUE(client_id, week_no)
);

CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins(client_id);

-- ═══════════════════════════════════════
-- PROGRAMS (generated weekly per client)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS programs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB,
  nutrition_plan JSONB,
  notes TEXT,
  UNIQUE(client_id, week_no)
);

CREATE INDEX IF NOT EXISTS idx_programs_client ON programs(client_id);

-- ═══════════════════════════════════════
-- MESSAGES (audit trail)
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT,
  direction TEXT CHECK (direction IN ('in', 'out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent'
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_messages_template ON messages(template_name);

-- ═══════════════════════════════════════
-- INTAKE FORMS
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS intake_forms (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  name TEXT,
  email TEXT,
  phone TEXT,
  age INTEGER,
  gender TEXT,
  goal TEXT,
  injuries TEXT,
  medical_conditions TEXT,
  diet_preference TEXT,
  workout_schedule TEXT,
  experience_level TEXT,
  current_weight NUMERIC(5,1),
  target_weight NUMERIC(5,1),
  height TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_lead ON intake_forms(lead_id);

-- ═══════════════════════════════════════
-- SCHEDULED NUDGES
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS scheduled_nudges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  nudge_24h_at TIMESTAMPTZ,
  nudge_48h_at TIMESTAMPTZ,
  nudge_24h_sent BOOLEAN DEFAULT FALSE,
  nudge_48h_sent BOOLEAN DEFAULT FALSE,
  UNIQUE(client_id, week_no)
);

-- ═══════════════════════════════════════
-- RESCHEDULE REQUESTS
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS reschedule_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  phone TEXT,
  preferred_date DATE,
  preferred_time TEXT,
  reason TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'denied')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════
-- STORAGE BUCKET
-- ═══════════════════════════════════════
-- Run this separately in Supabase dashboard or via:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('programs', 'programs', true);

-- ═══════════════════════════════════════
-- ROW LEVEL SECURITY (basic)
-- ═══════════════════════════════════════
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_nudges ENABLE ROW LEVEL SECURITY;
ALTER TABLE reschedule_requests ENABLE ROW LEVEL SECURITY;

-- Service role (used by API) has full access.
-- Anon role (used by admin dashboard) gets read access for authenticated users.
CREATE POLICY "Authenticated read leads" ON leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read clients" ON clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read checkins" ON checkins FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read programs" ON programs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read messages" ON messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read intake" ON intake_forms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read nudges" ON scheduled_nudges FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read reschedule" ON reschedule_requests FOR SELECT TO authenticated USING (true);

-- Service role bypass (full CRUD for API endpoints)
CREATE POLICY "Service full access leads" ON leads FOR ALL TO service_role USING (true);
CREATE POLICY "Service full access clients" ON clients FOR ALL TO service_role USING (true);
CREATE POLICY "Service full access checkins" ON checkins FOR ALL TO service_role USING (true);
CREATE POLICY "Service full access programs" ON programs FOR ALL TO service_role USING (true);
CREATE POLICY "Service full access messages" ON messages FOR ALL TO service_role USING (true);
CREATE POLICY "Service full access intake" ON intake_forms FOR ALL TO service_role USING (true);
CREATE POLICY "Service full access nudges" ON scheduled_nudges FOR ALL TO service_role USING (true);
CREATE POLICY "Service full access reschedule" ON reschedule_requests FOR ALL TO service_role USING (true);
