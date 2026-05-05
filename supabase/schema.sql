-- =============================================================================
-- FitnessByMaddy Automation Pipeline - Database Schema
-- =============================================================================
-- Supabase / PostgreSQL schema for lead tracking, client management,
-- weekly check-ins, program generation, and WhatsApp message audit trail.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. LEADS - Inbound lead tracking from WhatsApp and other sources
-- ---------------------------------------------------------------------------
CREATE TABLE leads (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           text        NOT NULL UNIQUE,
    name            text,
    source          text        DEFAULT 'whatsapp',
    status          text        DEFAULT 'new'
                                CHECK (status IN ('new', 'qualified', 'converted', 'dropped')),
    first_msg       text,
    last_msg_at     timestamptz,
    program_interest text,
    market          text        DEFAULT 'GLOBAL'
                                CHECK (market IN ('IN', 'UAE', 'UK', 'GLOBAL')),
    intake_data     jsonb,
    created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_leads_phone      ON leads (phone);
CREATE INDEX idx_leads_status     ON leads (status);
CREATE INDEX idx_leads_created_at ON leads (created_at);
CREATE INDEX idx_leads_market     ON leads (market);

COMMENT ON TABLE leads IS 'Tracks inbound leads from WhatsApp and other channels through qualification to conversion.';

-- ---------------------------------------------------------------------------
-- 2. CLIENTS - Active and past clients enrolled in programs
-- ---------------------------------------------------------------------------

CREATE TABLE clients (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id           uuid        REFERENCES leads (id),
    phone             text        NOT NULL,
    name              text,
    email             text,
    program           text        NOT NULL
                                  CHECK (program IN (
                                      '6wk_gym', '6wk_home', '12wk',
                                      'pcos', '40plus', 'zoom_trial', 'zoom_pack'
                                  )),
    program_started_at timestamptz DEFAULT now(),
    program_ends_at   timestamptz,
    paid_amount       numeric,
    checkout_id       text,
    folder_url        text,
    status            text        DEFAULT 'active'
                                  CHECK (status IN ('active', 'paused', 'completed', 'refunded')),
    created_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_clients_phone      ON clients (phone);
CREATE INDEX idx_clients_status     ON clients (status);
CREATE INDEX idx_clients_created_at ON clients (created_at);
CREATE INDEX idx_clients_lead_id    ON clients (lead_id);

COMMENT ON TABLE clients IS 'Active and past clients with program enrollment, payment, and status information.';

-- ---------------------------------------------------------------------------
-- 3. CHECKINS - Weekly client check-in submissions
-- ---------------------------------------------------------------------------

CREATE TABLE checkins (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id         uuid        NOT NULL REFERENCES clients (id),
    week_no           integer     NOT NULL,
    form_submitted_at timestamptz,
    weight            numeric,
    waist             numeric,
    compliance_score  integer     CHECK (compliance_score BETWEEN 1 AND 10),
    energy            integer     CHECK (energy BETWEEN 1 AND 10),
    issues            text,
    photos_urls       text[]      DEFAULT '{}',
    next_week_focus   text,
    created_at        timestamptz DEFAULT now(),

    CONSTRAINT uq_checkins_client_week UNIQUE (client_id, week_no)
);

CREATE INDEX idx_checkins_client_id  ON checkins (client_id);
CREATE INDEX idx_checkins_created_at ON checkins (created_at);

COMMENT ON TABLE checkins IS 'Weekly check-in data submitted by clients including weight, measurements, compliance, and progress photos.';

-- ---------------------------------------------------------------------------
-- 4. PROGRAMS - Generated weekly workout and nutrition programs
-- ---------------------------------------------------------------------------

CREATE TABLE programs (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       uuid        NOT NULL REFERENCES clients (id),
    week_no         integer     NOT NULL,
    generated_at    timestamptz,
    pdf_url         text,
    whatsapp_sent_at timestamptz,
    workout_plan    jsonb,
    nutrition_plan  jsonb,
    notes           text,
    created_at      timestamptz DEFAULT now(),

    CONSTRAINT uq_programs_client_week UNIQUE (client_id, week_no)
);

CREATE INDEX idx_programs_client_id  ON programs (client_id);
CREATE INDEX idx_programs_created_at ON programs (created_at);

COMMENT ON TABLE programs IS 'Auto-generated weekly workout and nutrition plans delivered to clients via WhatsApp/PDF.';

-- ---------------------------------------------------------------------------
-- 5. MESSAGES - Audit trail for all WhatsApp messages (inbound & outbound)
-- ---------------------------------------------------------------------------

CREATE TABLE messages (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         text        NOT NULL,
    direction     text        NOT NULL
                              CHECK (direction IN ('in', 'out')),
    body          text,
    template_name text,
    sent_at       timestamptz DEFAULT now(),
    status        text,
    created_at    timestamptz DEFAULT now()
);

CREATE INDEX idx_messages_phone      ON messages (phone);
CREATE INDEX idx_messages_sent_at    ON messages (sent_at);
CREATE INDEX idx_messages_created_at ON messages (created_at);
CREATE INDEX idx_messages_direction  ON messages (direction);

COMMENT ON TABLE messages IS 'Complete audit trail of all WhatsApp messages sent and received for compliance and debugging.';

-- =============================================================================
-- STORAGE BUCKETS (managed via Supabase Dashboard / CLI, not raw SQL)
-- =============================================================================
-- The following storage buckets should be created via the Supabase UI or CLI:
--
--   1. "checkin-photos"  - Client progress photos uploaded during weekly check-ins
--      - Private bucket, authenticated access only
--      - RLS: clients can upload to their own folder; coaches can read all
--
--   2. "program-pdfs"    - Generated PDF workout/nutrition plans
--      - Private bucket, authenticated access only
--      - RLS: clients can read their own PDFs; system service role can write
--
-- To create via Supabase CLI:
--   supabase storage create checkin-photos --private
--   supabase storage create program-pdfs --private
-- =============================================================================
