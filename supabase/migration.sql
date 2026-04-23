-- FitnessByMaddy automation pipeline schema

-- Leads table: every inbound WhatsApp contact
CREATE TABLE IF NOT EXISTS leads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text NOT NULL UNIQUE,
  name          text,
  source        text DEFAULT 'whatsapp',
  status        text NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new','qualified','converted','dropped')),
  first_msg     text,
  last_msg_at   timestamptz,
  program_interest text,
  market        text DEFAULT 'GLOBAL'
                  CHECK (market IN ('IN','UAE','UK','GLOBAL')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);

-- Clients table: converted leads with active programs
CREATE TABLE IF NOT EXISTS clients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid REFERENCES leads(id),
  phone           text NOT NULL,
  name            text,
  email           text,
  program         text NOT NULL
                    CHECK (program IN (
                      '6wk_gym','6wk_home','12wk','pcos','40plus',
                      'zoom_trial','zoom_pack'
                    )),
  program_started_at timestamptz,
  program_ends_at    timestamptz,
  paid_amount     integer,
  checkout_id     text,
  folder_url      text,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','paused','completed','refunded')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_lead ON clients(lead_id);

-- Weekly check-ins
CREATE TABLE IF NOT EXISTS checkins (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES clients(id),
  week_no           integer NOT NULL,
  form_submitted_at timestamptz,
  weight            numeric(5,1),
  waist             numeric(5,1),
  compliance_score  integer CHECK (compliance_score BETWEEN 1 AND 10),
  energy            integer CHECK (energy BETWEEN 1 AND 10),
  issues            text,
  photos_urls       text[] DEFAULT '{}',
  next_week_focus   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(client_id, week_no)
);

CREATE INDEX IF NOT EXISTS idx_checkins_client ON checkins(client_id);

-- Generated weekly programs (12-week clients)
CREATE TABLE IF NOT EXISTS programs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES clients(id),
  week_no         integer NOT NULL,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  pdf_url         text,
  whatsapp_sent_at timestamptz,
  workout_plan    jsonb,
  nutrition_plan  jsonb,
  notes           text,
  UNIQUE(client_id, week_no)
);

CREATE INDEX IF NOT EXISTS idx_programs_client ON programs(client_id);

-- Message audit trail
CREATE TABLE IF NOT EXISTS messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text NOT NULL,
  direction     text NOT NULL CHECK (direction IN ('in','out')),
  body          text,
  template_name text,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  status        text DEFAULT 'sent'
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone);
CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at);

-- Escalations queue
CREATE TABLE IF NOT EXISTS escalations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  client_id   uuid REFERENCES clients(id),
  lead_id     uuid REFERENCES leads(id),
  trigger     text NOT NULL,
  message     text,
  resolved    boolean DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escalations_resolved ON escalations(resolved);

-- Intake form data (detailed onboarding responses)
CREATE TABLE IF NOT EXISTS intake_data (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             uuid UNIQUE REFERENCES leads(id),
  name                text,
  email               text,
  phone               text,
  age                 integer,
  gender              text,
  height              text,
  weight              numeric(5,1),
  goal                text,
  injuries            text,
  medical_conditions  text,
  diet_preference     text,
  training_experience text,
  equipment_access    text,
  schedule            text,
  wake_time           text,
  sleep_time          text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Nudge tracking (prevents duplicate nudges)
CREATE TABLE IF NOT EXISTS nudge_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  nudge_type  text NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nudge_phone_type ON nudge_log(phone, nudge_type);
