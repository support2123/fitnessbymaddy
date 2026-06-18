-- ============================================================
-- Fitness by Maddy — Supabase schema migration
-- ============================================================
-- Environment variables required by the application:
--   AISENSY_API_KEY
--   SUPABASE_URL
--   SUPABASE_SERVICE_KEY
--   ANTHROPIC_API_KEY
--   RESEND_API_KEY
--   EXLY_WEBHOOK_SECRET
-- ============================================================

-- Enable pgcrypto for gen_random_uuid() (usually enabled by default on Supabase)
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. LEADS
-- ============================================================
create table if not exists leads (
  id              uuid primary key default gen_random_uuid(),
  phone           text not null unique,
  name            text,
  source          text default 'whatsapp',
  status          text default 'new'
                    check (status in ('new', 'qualified', 'converted', 'dropped')),
  first_msg       text,
  last_msg_at     timestamptz,
  program_interest text,
  market          text default 'IN'
                    check (market in ('IN', 'UAE', 'UK', 'GLOBAL')),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ============================================================
-- 2. CLIENTS
-- ============================================================
create table if not exists clients (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid references leads (id),
  phone           text not null,
  name            text,
  email           text,
  program         text
                    check (program in (
                      '6wk_gym', '6wk_home', '12wk',
                      'pcos', '40plus', 'zoom_trial', 'zoom_pack'
                    )),
  program_started_at timestamptz default now(),
  program_ends_at    timestamptz,
  paid_amount     integer,
  checkout_id     text,
  folder_url      text,
  status          text default 'active'
                    check (status in ('active', 'paused', 'completed', 'refunded')),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ============================================================
-- 3. CHECKINS
-- ============================================================
create table if not exists checkins (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references clients (id) not null,
  week_no         integer not null,
  form_submitted_at timestamptz default now(),
  weight          numeric,
  waist           numeric,
  compliance_score integer
                    check (compliance_score >= 1 and compliance_score <= 10),
  energy          integer
                    check (energy >= 1 and energy <= 10),
  issues          text,
  photos_urls     text[] default '{}',
  next_week_focus text,
  created_at      timestamptz default now()
);

-- ============================================================
-- 4. PROGRAMS
-- ============================================================
create table if not exists programs (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references clients (id) not null,
  week_no         integer not null,
  generated_at    timestamptz default now(),
  pdf_url         text,
  whatsapp_sent_at timestamptz,
  workout_plan    jsonb,
  nutrition_plan  jsonb,
  notes           text,
  created_at      timestamptz default now()
);

-- ============================================================
-- 5. INTAKE FORMS
-- ============================================================
create table if not exists intake_forms (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid references leads (id) not null,
  name            text,
  email           text,
  age             integer,
  goal            text,
  injuries        text,
  diet_pref       text,
  schedule        text,
  medical_conditions text,
  raw_data        jsonb,
  created_at      timestamptz default now()
);

create index if not exists idx_intake_forms_lead_id on intake_forms (lead_id);

-- ============================================================
-- 6. MESSAGES
-- ============================================================
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  phone           text not null,
  direction       text not null
                    check (direction in ('in', 'out')),
  body            text,
  template_name   text,
  sent_at         timestamptz default now(),
  status          text default 'sent',
  created_at      timestamptz default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index if not exists idx_leads_phone       on leads   (phone);
create index if not exists idx_leads_status      on leads   (status);
create index if not exists idx_clients_phone     on clients (phone);
create index if not exists idx_clients_status    on clients (status);
create index if not exists idx_clients_lead_id   on clients (lead_id);
create index if not exists idx_checkins_client_week on checkins (client_id, week_no);
create index if not exists idx_programs_client_week on programs (client_id, week_no);
create index if not exists idx_messages_phone    on messages (phone);
create index if not exists idx_messages_sent_at  on messages (sent_at);

-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Attach to leads
drop trigger if exists trg_leads_updated_at on leads;
create trigger trg_leads_updated_at
  before update on leads
  for each row
  execute function set_updated_at();

-- Attach to clients
drop trigger if exists trg_clients_updated_at on clients;
create trigger trg_clients_updated_at
  before update on clients
  for each row
  execute function set_updated_at();

-- ============================================================
-- ROW-LEVEL SECURITY (permissive — service role key is used)
-- ============================================================

-- Enable RLS on all tables
alter table leads    enable row level security;
alter table clients  enable row level security;
alter table checkins enable row level security;
alter table programs enable row level security;
alter table intake_forms enable row level security;
alter table messages enable row level security;

-- Permissive policies: allow all operations for authenticated / service role
create policy "Allow all for service role" on leads
  for all using (true) with check (true);

create policy "Allow all for service role" on clients
  for all using (true) with check (true);

create policy "Allow all for service role" on checkins
  for all using (true) with check (true);

create policy "Allow all for service role" on programs
  for all using (true) with check (true);

create policy "Allow all for service role" on intake_forms
  for all using (true) with check (true);

create policy "Allow all for service role" on messages
  for all using (true) with check (true);
