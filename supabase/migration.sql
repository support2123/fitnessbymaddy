-- FitnessByMaddy automation pipeline schema

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  name TEXT,
  source TEXT DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
  first_msg TEXT,
  last_msg_at TIMESTAMPTZ DEFAULT now(),
  program_interest TEXT,
  market TEXT DEFAULT 'GLOBAL' CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS leads_phone_idx ON leads (phone);

CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id),
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  program TEXT NOT NULL CHECK (program IN ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at TIMESTAMPTZ DEFAULT now(),
  program_ends_at TIMESTAMPTZ,
  paid_amount INTEGER,
  checkout_id TEXT,
  folder_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS clients_phone_idx ON clients (phone);
CREATE INDEX IF NOT EXISTS clients_status_idx ON clients (status);

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
  next_week_focus TEXT
);

CREATE INDEX IF NOT EXISTS checkins_client_week_idx ON checkins (client_id, week_no);

CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  week_no INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT now(),
  pdf_url TEXT,
  whatsapp_sent_at TIMESTAMPTZ,
  workout_plan JSONB,
  nutrition_plan JSONB,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS programs_client_week_idx ON programs (client_id, week_no);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT,
  template_name TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'sent'
);

CREATE INDEX IF NOT EXISTS messages_phone_idx ON messages (phone);
CREATE INDEX IF NOT EXISTS messages_sent_at_idx ON messages (sent_at);

CREATE TABLE IF NOT EXISTS lead_intake (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  name TEXT,
  email TEXT,
  phone TEXT,
  age INTEGER,
  gender TEXT,
  goal TEXT,
  injuries TEXT,
  diet_pref TEXT,
  schedule TEXT,
  medical_conditions TEXT,
  experience_level TEXT,
  submitted_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lead_intake_lead_idx ON lead_intake (lead_id);

-- Storage bucket for program PDFs
-- Run in Supabase Dashboard > Storage: Create bucket "programs" (public)

-- Enable Row Level Security
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_intake ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by API)
-- Anon/authenticated read access for admin dashboard
CREATE POLICY "Admin read leads" ON leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin read clients" ON clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin read checkins" ON checkins FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin read programs" ON programs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin read messages" ON messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin read intake" ON lead_intake FOR SELECT TO authenticated USING (true);

-- Service role bypass policies
CREATE POLICY "Service full access leads" ON leads FOR ALL TO service_role USING (true);
CREATE POLICY "Service full access clients" ON clients FOR ALL TO service_role USING (true);
CREATE POLICY "Service full access checkins" ON checkins FOR ALL TO service_role USING (true);
CREATE POLICY "Service full access programs" ON programs FOR ALL TO service_role USING (true);
CREATE POLICY "Service full access messages" ON messages FOR ALL TO service_role USING (true);
CREATE POLICY "Service full access intake" ON lead_intake FOR ALL TO service_role USING (true);
