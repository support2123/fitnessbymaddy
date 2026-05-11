-- FitnessByMaddy automation pipeline — Supabase migration
-- Run this in the Supabase SQL editor

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- =============================================================
-- LEADS
-- =============================================================
create table if not exists leads (
  id uuid primary key default uuid_generate_v4(),
  phone text not null,
  name text,
  source text default 'whatsapp',
  status text not null default 'new'
    check (status in ('new', 'qualified', 'converted', 'dropped')),
  first_msg text,
  last_msg_at timestamptz default now(),
  program_interest text,
  market text default 'GLOBAL'
    check (market in ('IN', 'UAE', 'UK', 'GLOBAL')),
  created_at timestamptz default now()
);

create unique index if not exists leads_phone_idx on leads (phone);
create index if not exists leads_status_idx on leads (status);
create index if not exists leads_created_idx on leads (created_at);

-- =============================================================
-- CLIENTS
-- =============================================================
create table if not exists clients (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid references leads(id),
  phone text not null,
  name text,
  email text,
  program text not null
    check (program in (
      '6wk_gym', '6wk_home', '12wk', 'pcos', '40plus',
      'zoom_trial', 'zoom_pack'
    )),
  program_started_at timestamptz default now(),
  program_ends_at timestamptz,
  paid_amount integer default 0,
  checkout_id text,
  folder_url text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'completed', 'refunded')),
  created_at timestamptz default now()
);

create index if not exists clients_phone_idx on clients (phone);
create index if not exists clients_status_idx on clients (status);
create index if not exists clients_program_idx on clients (program);

-- =============================================================
-- CHECKINS (weekly)
-- =============================================================
create table if not exists checkins (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references clients(id),
  week_no integer not null,
  form_submitted_at timestamptz default now(),
  weight numeric,
  waist numeric,
  compliance_score integer check (compliance_score between 1 and 10),
  energy integer check (energy between 1 and 10),
  issues text,
  photos_urls jsonb default '[]'::jsonb,
  next_week_focus text,
  created_at timestamptz default now()
);

create unique index if not exists checkins_client_week_idx
  on checkins (client_id, week_no);
create index if not exists checkins_client_idx on checkins (client_id);

-- =============================================================
-- PROGRAMS (generated weekly per client)
-- =============================================================
create table if not exists programs (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references clients(id),
  week_no integer not null,
  generated_at timestamptz default now(),
  pdf_url text,
  whatsapp_sent_at timestamptz,
  workout_plan jsonb,
  nutrition_plan jsonb,
  notes text,
  created_at timestamptz default now()
);

create unique index if not exists programs_client_week_idx
  on programs (client_id, week_no);
create index if not exists programs_client_idx on programs (client_id);

-- =============================================================
-- MESSAGES (audit trail)
-- =============================================================
create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  phone text not null,
  direction text not null check (direction in ('in', 'out')),
  body text,
  template_name text,
  sent_at timestamptz default now(),
  status text default 'sent'
);

create index if not exists messages_phone_idx on messages (phone);
create index if not exists messages_sent_idx on messages (sent_at);

-- =============================================================
-- Row-Level Security (RLS) — admin-only access via service key
-- =============================================================
alter table leads enable row level security;
alter table clients enable row level security;
alter table checkins enable row level security;
alter table programs enable row level security;
alter table messages enable row level security;

-- Service role bypasses RLS, so API endpoints using SUPABASE_SERVICE_KEY
-- will have full access. No public-facing policies needed.

-- =============================================================
-- Storage bucket for client files
-- =============================================================
insert into storage.buckets (id, name, public)
values ('clients', 'clients', false)
on conflict (id) do nothing;
