-- ============================================================================
-- FitnessByMaddy Coaching Automation System — Supabase Schema
-- ============================================================================
-- This migration sets up the complete database schema for lead tracking,
-- client management, weekly check-ins, program generation, and messaging.
-- The script is idempotent: every CREATE uses IF NOT EXISTS so it can be
-- re-run safely against an existing database.
-- ============================================================================


-- ============================================================================
-- 1. LEADS
-- Captures every inbound enquiry (WhatsApp, Instagram, website form, etc.)
-- and tracks the prospect through qualification to conversion or drop.
-- ============================================================================
CREATE TABLE IF NOT EXISTS leads (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    phone            text        NOT NULL UNIQUE,
    name             text,
    email            text,
    source           text        DEFAULT 'whatsapp',
    status           text        DEFAULT 'new'
                                 CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
    first_msg        text,
    last_msg_at      timestamptz DEFAULT now(),
    program_interest text,
    market           text        DEFAULT 'GLOBAL'
                                 CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
    lead_details     jsonb,
    created_at       timestamptz DEFAULT now()
);

COMMENT ON TABLE  leads IS 'Inbound leads from all channels (WhatsApp, IG, web).';
COMMENT ON COLUMN leads.market IS 'Pricing / currency zone: IN, UAE, UK, or GLOBAL.';
COMMENT ON COLUMN leads.lead_details IS 'Free-form JSON for any extra intake data.';


-- ============================================================================
-- 2. CLIENTS
-- A lead becomes a client once they pay. Tracks program type, dates, payment,
-- and the link to their Google Drive / shared folder.
-- ============================================================================
CREATE TABLE IF NOT EXISTS clients (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id            uuid        REFERENCES leads(id),
    phone              text        NOT NULL,
    name               text,
    email              text,
    program            text
                                   CHECK (program IN (
                                       '6wk_gym', '6wk_home', '12wk',
                                       'pcos', '40plus',
                                       'zoom_trial', 'zoom_pack'
                                   )),
    program_started_at timestamptz DEFAULT now(),
    program_ends_at    timestamptz,
    paid_amount        integer,
    checkout_id        text,
    folder_url         text,
    status             text        DEFAULT 'active'
                                   CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
    created_at         timestamptz DEFAULT now()
);

COMMENT ON TABLE  clients IS 'Paying clients with active or past programs.';
COMMENT ON COLUMN clients.paid_amount IS 'Amount in smallest currency unit (paise / fils / pence).';
COMMENT ON COLUMN clients.checkout_id IS 'Razorpay / Stripe checkout or payment ID.';
COMMENT ON COLUMN clients.folder_url IS 'Link to the client''s shared Google Drive folder.';


-- ============================================================================
-- 3. CHECKINS
-- Weekly check-in form submitted by the client. A row is pre-created with a
-- unique token link; the remaining columns are filled when the form is
-- submitted.
-- ============================================================================
CREATE TABLE IF NOT EXISTS checkins (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id         uuid        REFERENCES clients(id),
    week_no           integer     NOT NULL,
    token             text        UNIQUE,
    form_submitted_at timestamptz,                        -- NULL until submitted
    weight            numeric,
    waist             numeric,
    compliance_score  integer     CHECK (compliance_score BETWEEN 1 AND 10),
    energy            integer     CHECK (energy BETWEEN 1 AND 10),
    issues            text,
    photos_urls       text[],                             -- array of URLs
    next_week_focus   text,
    created_at        timestamptz DEFAULT now(),

    UNIQUE (client_id, week_no)
);

COMMENT ON TABLE  checkins IS 'Weekly client check-ins (weight, waist, photos, self-scores).';
COMMENT ON COLUMN checkins.token IS 'One-time token embedded in the check-in URL sent via WhatsApp.';
COMMENT ON COLUMN checkins.compliance_score IS 'Self-reported adherence to the plan (1-10).';
COMMENT ON COLUMN checkins.photos_urls IS 'Array of Supabase Storage URLs for progress photos.';


-- ============================================================================
-- 4. PROGRAMS
-- AI-generated (or manually created) weekly workout + nutrition plans.
-- One row per client per week.
-- ============================================================================
CREATE TABLE IF NOT EXISTS programs (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id        uuid        REFERENCES clients(id),
    week_no          integer     NOT NULL,
    generated_at     timestamptz DEFAULT now(),
    pdf_url          text,
    whatsapp_sent_at timestamptz,
    workout_plan     jsonb,
    nutrition_plan   jsonb,
    notes            text,

    UNIQUE (client_id, week_no)
);

COMMENT ON TABLE  programs IS 'Weekly workout and nutrition plans generated for each client.';
COMMENT ON COLUMN programs.pdf_url IS 'Supabase Storage or external URL to the PDF version.';
COMMENT ON COLUMN programs.workout_plan IS 'Structured JSON: exercises, sets, reps, rest, etc.';
COMMENT ON COLUMN programs.nutrition_plan IS 'Structured JSON: meals, macros, calories, etc.';


-- ============================================================================
-- 5. MESSAGES
-- Audit log for every WhatsApp message sent or received, including template
-- messages triggered by automations.
-- ============================================================================
CREATE TABLE IF NOT EXISTS messages (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         text        NOT NULL,
    direction     text        CHECK (direction IN ('in', 'out')),
    body          text,
    template_name text,
    sent_at       timestamptz DEFAULT now(),
    status        text        DEFAULT 'sent'
);

COMMENT ON TABLE  messages IS 'WhatsApp message log (inbound and outbound).';
COMMENT ON COLUMN messages.template_name IS 'Name of the WhatsApp-approved template, if used.';
COMMENT ON COLUMN messages.status IS 'Delivery status: sent, delivered, read, failed.';


-- ============================================================================
-- 6. INDEXES
-- Speed up the most common look-ups: phone searches, status filters,
-- foreign-key joins, and time-range queries on messages.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_leads_phone       ON leads    (phone);
CREATE INDEX IF NOT EXISTS idx_leads_status      ON leads    (status);
CREATE INDEX IF NOT EXISTS idx_clients_phone     ON clients  (phone);
CREATE INDEX IF NOT EXISTS idx_clients_status    ON clients  (status);
CREATE INDEX IF NOT EXISTS idx_checkins_client   ON checkins (client_id);
CREATE INDEX IF NOT EXISTS idx_checkins_token    ON checkins (token);
CREATE INDEX IF NOT EXISTS idx_messages_phone    ON messages (phone);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at  ON messages (sent_at);


-- ============================================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- Enable RLS on every table. Only the service_role key (used by backend
-- functions / Edge Functions) can bypass the policies. The anon and
-- authenticated roles have no access by default — add finer-grained
-- policies later if you expose tables directly to a client app.
-- ============================================================================

-- Leads
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to leads" ON leads;
CREATE POLICY "Service role has full access to leads"
    ON leads
    FOR ALL
    USING  (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Clients
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to clients" ON clients;
CREATE POLICY "Service role has full access to clients"
    ON clients
    FOR ALL
    USING  (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Checkins
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to checkins" ON checkins;
CREATE POLICY "Service role has full access to checkins"
    ON checkins
    FOR ALL
    USING  (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Programs
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to programs" ON programs;
CREATE POLICY "Service role has full access to programs"
    ON programs
    FOR ALL
    USING  (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Messages
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to messages" ON messages;
CREATE POLICY "Service role has full access to messages"
    ON messages
    FOR ALL
    USING  (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');


-- Admin dashboard read-only access for authenticated users
DROP POLICY IF EXISTS "Authenticated users can read leads" ON leads;
CREATE POLICY "Authenticated users can read leads"
    ON leads FOR SELECT
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can read clients" ON clients;
CREATE POLICY "Authenticated users can read clients"
    ON clients FOR SELECT
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can read checkins" ON checkins;
CREATE POLICY "Authenticated users can read checkins"
    ON checkins FOR SELECT
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can read programs" ON programs;
CREATE POLICY "Authenticated users can read programs"
    ON programs FOR SELECT
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can read messages" ON messages;
CREATE POLICY "Authenticated users can read messages"
    ON messages FOR SELECT
    USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update messages" ON messages;
CREATE POLICY "Authenticated users can update messages"
    ON messages FOR UPDATE
    USING (auth.role() = 'authenticated');


-- ============================================================================
-- 8. STORAGE BUCKET
-- Create a private bucket for client progress photos, PDF plans, and any
-- other files. Access is controlled via signed URLs generated by backend
-- functions.
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-files', 'client-files', false)
ON CONFLICT (id) DO NOTHING;

COMMENT ON COLUMN storage.buckets.id IS 'Bucket for progress photos, PDFs, and client documents.';


-- ============================================================================
-- 9. CONVERSION RATE VIEW
-- Shows per-source lead counts, conversion counts, and the conversion rate
-- as a percentage. Useful for dashboard widgets and reporting queries.
-- ============================================================================
CREATE OR REPLACE VIEW lead_conversion_rates AS
SELECT
    source,
    market,
    COUNT(*)                                              AS total_leads,
    COUNT(*) FILTER (WHERE status = 'converted')          AS converted_leads,
    ROUND(
        COUNT(*) FILTER (WHERE status = 'converted')
        * 100.0 / NULLIF(COUNT(*), 0),
        2
    )                                                     AS conversion_rate_pct
FROM leads
GROUP BY source, market;

COMMENT ON VIEW lead_conversion_rates IS
    'Aggregated conversion rates broken down by lead source and market.';


-- ============================================================================
-- 10. CONVERSION RATE FUNCTION
-- A callable function that accepts optional source and market filters and
-- returns a single-row summary. Handy for Edge Function dashboards.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_conversion_rate(
    p_source text DEFAULT NULL,
    p_market text DEFAULT NULL
)
RETURNS TABLE (
    total_leads       bigint,
    converted_leads   bigint,
    conversion_rate   numeric
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        COUNT(*)                                              AS total_leads,
        COUNT(*) FILTER (WHERE status = 'converted')          AS converted_leads,
        ROUND(
            COUNT(*) FILTER (WHERE status = 'converted')
            * 100.0 / NULLIF(COUNT(*), 0),
            2
        )                                                     AS conversion_rate
    FROM leads
    WHERE (p_source IS NULL OR source = p_source)
      AND (p_market IS NULL OR market = p_market);
$$;

COMMENT ON FUNCTION get_conversion_rate IS
    'Returns total leads, converted leads, and conversion rate %, with optional source/market filters.';
