-- ============================================================
-- Fitness by Maddy – Supabase Database Schema
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. LEADS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    phone            text        NOT NULL,
    name             text,
    source           text        DEFAULT 'whatsapp',
    status           text        DEFAULT 'new'
                                 CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
    first_msg        text,
    last_msg_at      timestamptz,
    program_interest text,
    market           text        DEFAULT 'GLOBAL'
                                 CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
    created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_phone      ON leads (phone);
CREATE INDEX IF NOT EXISTS idx_leads_status     ON leads (status);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads (created_at);

-- ────────────────────────────────────────────────────────────
-- 2. CLIENTS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id            uuid        REFERENCES leads (id),
    phone              text        NOT NULL,
    name               text,
    email              text,
    program            text        CHECK (program IN (
                                       '6wk_gym', '6wk_home', '12wk',
                                       'pcos', '40plus',
                                       'zoom_trial', 'zoom_pack'
                                   )),
    program_started_at timestamptz,
    program_ends_at    timestamptz,
    paid_amount        integer,          -- stored in cents
    checkout_id        text,
    folder_url         text,
    status             text        DEFAULT 'active'
                                   CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
    created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_phone   ON clients (phone);
CREATE INDEX IF NOT EXISTS idx_clients_status  ON clients (status);
CREATE INDEX IF NOT EXISTS idx_clients_lead_id ON clients (lead_id);

-- ────────────────────────────────────────────────────────────
-- 3. CHECKINS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checkins (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id         uuid        NOT NULL REFERENCES clients (id),
    week_no           integer     NOT NULL,
    form_submitted_at timestamptz,
    weight            numeric,
    waist             numeric,
    compliance_score  integer     CHECK (compliance_score BETWEEN 1 AND 10),
    energy            integer     CHECK (energy BETWEEN 1 AND 10),
    issues            text,
    photos_urls       text[],
    next_week_focus   text,
    nudge_count       integer     DEFAULT 0,
    sent_at           timestamptz,
    created_at        timestamptz DEFAULT now(),

    UNIQUE (client_id, week_no)
);

-- ────────────────────────────────────────────────────────────
-- 4. PROGRAMS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS programs (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id        uuid        NOT NULL REFERENCES clients (id),
    week_no          integer     NOT NULL,
    generated_at     timestamptz DEFAULT now(),
    pdf_url          text,
    whatsapp_sent_at timestamptz,
    workout_plan     jsonb,
    nutrition_plan   jsonb,
    notes            text,

    UNIQUE (client_id, week_no)
);

-- ────────────────────────────────────────────────────────────
-- 5. MESSAGES
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         text        NOT NULL,
    direction     text        NOT NULL
                              CHECK (direction IN ('in', 'out')),
    body          text,
    template_name text,
    sent_at       timestamptz DEFAULT now(),
    status        text        DEFAULT 'sent'
);

CREATE INDEX IF NOT EXISTS idx_messages_phone   ON messages (phone);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages (sent_at);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Enable RLS on every table, then grant full access to the
-- service_role so back-end / Edge Functions work unimpeded.
-- ============================================================

ALTER TABLE leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Permissive policies for the service_role (bypasses RLS by
-- default, but explicit policies make the intent clear and
-- protect against accidental config changes).

CREATE POLICY "service_role_all_leads"
    ON leads FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "service_role_all_clients"
    ON clients FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "service_role_all_checkins"
    ON checkins FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "service_role_all_programs"
    ON programs FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "service_role_all_messages"
    ON messages FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
