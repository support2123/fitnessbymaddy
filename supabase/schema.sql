-- FitnessByMaddy — Supabase schema
-- Run in order. All tables use uuid primary keys and created_at defaults.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- leads
-- ============================================================
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text,
  source text,
  status text not null default 'new' check (status in ('new','qualified','converted','dropped')),
  first_msg text,
  last_msg_at timestamptz,
  program_interest text,
  market text check (market in ('IN','UAE','UK','GLOBAL')),
  escalated boolean not null default false,
  escalation_reason text,
  nudge_count int not null default 0,
  opted_out boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_last_msg_idx on public.leads(last_msg_at);

-- ============================================================
-- clients
-- ============================================================
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  phone text not null unique,
  name text,
  email text,
  program text not null check (program in
    ('6wk_gym','6wk_home','12wk','pcos','40plus','zoom_trial','zoom_pack')),
  program_started_at timestamptz,
  program_ends_at timestamptz,
  paid_amount numeric(10,2),
  checkout_id text,
  folder_url text,
  market text,
  status text not null default 'active' check (status in ('active','paused','completed','refunded')),
  missed_checkins int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists clients_status_idx on public.clients(status);
create index if not exists clients_program_idx on public.clients(program);

-- ============================================================
-- checkins
-- ============================================================
create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  week_no int not null,
  token text unique,
  form_submitted_at timestamptz,
  weight numeric(5,2),
  waist numeric(5,2),
  compliance_score int check (compliance_score between 1 and 10),
  energy int check (energy between 1 and 10),
  issues text,
  photos_urls jsonb default '[]'::jsonb,
  next_week_focus text,
  created_at timestamptz not null default now(),
  unique (client_id, week_no)
);
create index if not exists checkins_client_week on public.checkins(client_id, week_no desc);

-- ============================================================
-- programs (weekly generated)
-- ============================================================
create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  week_no int not null,
  generated_at timestamptz not null default now(),
  pdf_url text,
  whatsapp_sent_at timestamptz,
  workout_plan jsonb,
  nutrition_plan jsonb,
  notes text,
  flagged_for_review boolean not null default false,
  flag_reason text,
  unique (client_id, week_no)
);
create index if not exists programs_client_week on public.programs(client_id, week_no desc);

-- ============================================================
-- messages (audit trail)
-- ============================================================
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  direction text not null check (direction in ('in','out')),
  body text,
  template_name text,
  sent_at timestamptz not null default now(),
  status text
);
create index if not exists messages_phone_idx on public.messages(phone, sent_at desc);

-- ============================================================
-- escalations (Maddy review queue)
-- ============================================================
create table if not exists public.escalations (
  id uuid primary key default gen_random_uuid(),
  phone text,
  lead_id uuid references public.leads(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  trigger text not null,
  detail text,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists escalations_unresolved on public.escalations(resolved, created_at desc);

-- ============================================================
-- Storage bucket for client folders (created via Supabase dashboard or API)
-- Name: clients  (public: false, service role only writes)
-- ============================================================
