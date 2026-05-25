-- =============================================================================
-- FitnessByMaddy - WhatsApp Coaching Automation Pipeline
-- Complete Database Schema Migration
-- =============================================================================
-- Run this against your Supabase project via the SQL Editor or CLI.
-- Uses IF NOT EXISTS / OR REPLACE to keep the migration idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- provides gen_random_uuid()

-- ---------------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------------

-- ---- leads ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    phone            text        NOT NULL UNIQUE,
    name             text,
    email            text,
    source           text        CHECK (source IN ('instagram', 'whatsapp', 'website', 'referral')),
    status           text        NOT NULL DEFAULT 'new'
                                 CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
    first_msg        text,
    last_msg_at      timestamptz,
    program_interest text        CHECK (program_interest IN (
                                     '6wk_gym', '6wk_home', '12wk',
                                     'pcos', '40plus', 'zoom_trial', 'zoom_pack'
                                 )),
    market           text        DEFAULT 'GLOBAL'
                                 CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
    intake_data      jsonb,
    created_at       timestamptz DEFAULT now(),
    updated_at       timestamptz DEFAULT now()
);

-- ---- clients --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id            uuid        REFERENCES leads(id),
    phone              text        NOT NULL,
    name               text        NOT NULL,
    email              text,
    program            text        NOT NULL
                                   CHECK (program IN (
                                       '6wk_gym', '6wk_home', '12wk',
                                       'pcos', '40plus', 'zoom_trial', 'zoom_pack'
                                   )),
    program_started_at timestamptz DEFAULT now(),
    program_ends_at    timestamptz,
    paid_amount        integer,          -- stored in cents
    checkout_id        text,
    folder_url         text,
    status             text        NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
    created_at         timestamptz DEFAULT now(),
    updated_at         timestamptz DEFAULT now()
);

-- ---- checkins -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS checkins (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id         uuid        NOT NULL REFERENCES clients(id),
    week_no           integer     NOT NULL,
    form_submitted_at timestamptz DEFAULT now(),
    weight            numeric(5,2),
    waist             numeric(5,2),
    compliance_score  integer     CHECK (compliance_score BETWEEN 1 AND 10),
    energy            integer     CHECK (energy BETWEEN 1 AND 10),
    issues            text,
    wins              text,
    photos_urls       text[],             -- array of photo URLs
    next_week_focus   text,
    notes             text
);

-- ---- programs -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS programs (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id         uuid        NOT NULL REFERENCES clients(id),
    week_no           integer     NOT NULL,
    generated_at      timestamptz DEFAULT now(),
    pdf_url           text,
    whatsapp_sent_at  timestamptz,
    workout_plan      jsonb,
    nutrition_plan    jsonb,
    notes             text,
    flagged_for_review boolean    DEFAULT false,
    reviewed_by       text,
    reviewed_at       timestamptz
);

-- ---- messages -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         text        NOT NULL,
    direction     text        NOT NULL CHECK (direction IN ('in', 'out')),
    body          text,
    template_name text,
    sent_at       timestamptz DEFAULT now(),
    status        text        DEFAULT 'sent',
    metadata      jsonb
);

-- ---- escalations ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS escalations (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         text        NOT NULL,
    trigger_word  text,
    message_body  text,
    source        text        CHECK (source IN ('whatsapp', 'checkin', 'system')),
    resolved      boolean     DEFAULT false,
    resolved_by   text,
    resolved_at   timestamptz,
    created_at    timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. INDEXES
-- ---------------------------------------------------------------------------
-- Using IF NOT EXISTS (Postgres 9.5+) to stay idempotent.

CREATE INDEX IF NOT EXISTS idx_leads_phone
    ON leads(phone);

CREATE INDEX IF NOT EXISTS idx_leads_status
    ON leads(status);

CREATE INDEX IF NOT EXISTS idx_clients_phone
    ON clients(phone);

CREATE INDEX IF NOT EXISTS idx_clients_status
    ON clients(status);

CREATE INDEX IF NOT EXISTS idx_clients_lead_id
    ON clients(lead_id);

-- Unique composite indexes (one checkin & one program per client per week)
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_client_week
    ON checkins(client_id, week_no);

CREATE UNIQUE INDEX IF NOT EXISTS idx_programs_client_week
    ON programs(client_id, week_no);

CREATE INDEX IF NOT EXISTS idx_messages_phone_sent
    ON messages(phone, sent_at);

CREATE INDEX IF NOT EXISTS idx_escalations_resolved_created
    ON escalations(resolved, created_at);

-- ---------------------------------------------------------------------------
-- 3. AUTO-UPDATE updated_at TRIGGER
-- ---------------------------------------------------------------------------
-- A reusable trigger function that sets updated_at = now() on every UPDATE.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop-and-recreate the triggers to keep this idempotent.
DROP TRIGGER IF EXISTS trg_leads_updated_at ON leads;
CREATE TRIGGER trg_leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_clients_updated_at ON clients;
CREATE TRIGGER trg_clients_updated_at
    BEFORE UPDATE ON clients
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS)
-- ---------------------------------------------------------------------------
-- Enable RLS on every table.  Two policy tiers:
--   a) service_role  -> full CRUD  (used by serverless functions / Edge Functions)
--   b) authenticated -> read-only  (used by the admin dashboard via anon/JWT)

ALTER TABLE leads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients     ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins    ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;

-- Helper: drop a policy only if it exists (keeps the script re-runnable).
-- Postgres doesn't have DROP POLICY IF EXISTS before v15, so we use a
-- DO block that swallows the "does not exist" error.
DO $$
DECLARE
    _policies text[] := ARRAY[
        'service_role_leads',       'auth_read_leads',
        'service_role_clients',     'auth_read_clients',
        'service_role_checkins',    'auth_read_checkins',
        'service_role_programs',    'auth_read_programs',
        'service_role_messages',    'auth_read_messages',
        'service_role_escalations', 'auth_read_escalations'
    ];
    _tables text[] := ARRAY[
        'leads',       'leads',
        'clients',     'clients',
        'checkins',    'checkins',
        'programs',    'programs',
        'messages',    'messages',
        'escalations', 'escalations'
    ];
    i int;
BEGIN
    FOR i IN 1 .. array_length(_policies, 1) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', _policies[i], _tables[i]);
    END LOOP;
END $$;

-- ---- service_role: full access on all tables ------------------------------

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

CREATE POLICY service_role_escalations ON escalations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ---- authenticated: read-only access (admin dashboard) --------------------

CREATE POLICY auth_read_leads ON leads
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY auth_read_clients ON clients
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY auth_read_checkins ON checkins
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY auth_read_programs ON programs
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY auth_read_messages ON messages
    FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY auth_read_escalations ON escalations
    FOR SELECT
    TO authenticated
    USING (true);

-- ---------------------------------------------------------------------------
-- 5. SUPABASE STORAGE BUCKET
-- ---------------------------------------------------------------------------
-- Supabase stores bucket metadata in storage.buckets.  The INSERT below
-- creates the bucket if it doesn't already exist.  If your Supabase project
-- version doesn't expose the storage schema to SQL, create the bucket via:
--   Dashboard -> Storage -> New Bucket -> name: "clients", Public: OFF
--
-- The bucket is private by default; your Edge Functions should generate
-- signed URLs when sharing files with clients.

INSERT INTO storage.buckets (id, name, public)
VALUES ('clients', 'clients', false)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Done!
-- ---------------------------------------------------------------------------
