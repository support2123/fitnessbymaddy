-- FitnessByMaddy: Supabase database migration
-- Run with: psql $DATABASE_URL -f migration.sql
-- Or paste into Supabase SQL Editor

BEGIN;

-- ============================================================
-- 1. TABLES
-- ============================================================

-- Leads captured from WhatsApp / landing pages
CREATE TABLE IF NOT EXISTS leads (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    phone            text        NOT NULL UNIQUE,
    name             text,
    source           text        DEFAULT 'whatsapp',
    status           text        NOT NULL DEFAULT 'new'
                                 CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
    first_msg        text,
    last_msg_at      timestamptz,
    program_interest text,
    market           text        DEFAULT 'IN'
                                 CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
    created_at       timestamptz DEFAULT now(),
    updated_at       timestamptz DEFAULT now()
);

-- Paying / enrolled clients
CREATE TABLE IF NOT EXISTS clients (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id           uuid        REFERENCES leads(id),
    phone             text        NOT NULL,
    name              text,
    email             text,
    program           text        NOT NULL
                                  CHECK (program IN (
                                      '6wk_gym', '6wk_home', '12wk',
                                      'pcos', '40plus', 'zoom_trial', 'zoom_pack'
                                  )),
    program_started_at timestamptz DEFAULT now(),
    program_ends_at    timestamptz,
    paid_amount        integer,
    checkout_id        text,
    folder_url         text,
    status             text        NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
    created_at         timestamptz DEFAULT now()
);

-- Weekly check-ins submitted by clients
CREATE TABLE IF NOT EXISTS checkins (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id        uuid        NOT NULL REFERENCES clients(id),
    week_no          integer     NOT NULL,
    form_submitted_at timestamptz DEFAULT now(),
    weight           numeric,
    waist            numeric,
    compliance_score integer     CHECK (compliance_score BETWEEN 1 AND 10),
    energy           integer     CHECK (energy BETWEEN 1 AND 10),
    issues           text,
    photos_urls      text[]      DEFAULT '{}',
    next_week_focus  text,
    sleep_quality    integer,
    stress_level     integer,
    meals_on_plan    numeric,
    workouts_completed integer,
    biggest_win      text,
    notes_for_coach  text,

    UNIQUE (client_id, week_no)
);

-- Generated weekly programs (workout + nutrition)
CREATE TABLE IF NOT EXISTS programs (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id        uuid        NOT NULL REFERENCES clients(id),
    week_no          integer     NOT NULL,
    generated_at     timestamptz DEFAULT now(),
    pdf_url          text,
    whatsapp_sent_at timestamptz,
    workout_plan     jsonb,
    nutrition_plan   jsonb,
    notes            text,

    UNIQUE (client_id, week_no)
);

-- Message audit trail (WhatsApp in/out)
CREATE TABLE IF NOT EXISTS messages (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         text        NOT NULL,
    direction     text        NOT NULL
                              CHECK (direction IN ('in', 'out')),
    body          text,
    template_name text,
    sent_at       timestamptz DEFAULT now(),
    status        text
);

-- ============================================================
-- 2. INDEXES
-- ============================================================

-- leads
CREATE INDEX IF NOT EXISTS idx_leads_phone      ON leads (phone);
CREATE INDEX IF NOT EXISTS idx_leads_status     ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at);

-- clients
CREATE INDEX IF NOT EXISTS idx_clients_phone   ON clients (phone);
CREATE INDEX IF NOT EXISTS idx_clients_lead_id ON clients (lead_id);
CREATE INDEX IF NOT EXISTS idx_clients_status  ON clients (status);

-- checkins
CREATE INDEX IF NOT EXISTS idx_checkins_client_id          ON checkins (client_id);
CREATE INDEX IF NOT EXISTS idx_checkins_client_id_week_no  ON checkins (client_id, week_no);

-- programs
CREATE INDEX IF NOT EXISTS idx_programs_client_id          ON programs (client_id);
CREATE INDEX IF NOT EXISTS idx_programs_client_id_week_no  ON programs (client_id, week_no);

-- messages
CREATE INDEX IF NOT EXISTS idx_messages_phone   ON messages (phone);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages (sent_at);

-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Service-role bypass policies (the backend connects with the
-- service_role key, which has the 'service_role' role in Supabase).
-- These policies grant full access to the service role while keeping
-- RLS enforced for any other callers (e.g. anon, authenticated).

CREATE POLICY service_role_leads ON leads
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY service_role_clients ON clients
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY service_role_checkins ON checkins
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY service_role_programs ON programs
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY service_role_messages ON messages
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

COMMIT;
