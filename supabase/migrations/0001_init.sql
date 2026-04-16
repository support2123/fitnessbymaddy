-- FitnessByMaddy automation schema
-- Run via: psql $SUPABASE_DB_URL -f 0001_init.sql
--   or paste into Supabase SQL editor.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- LEADS
-- ============================================================
do $$ begin
  create type lead_status as enum ('new','qualified','converted','dropped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type market_code as enum ('IN','UAE','UK','GLOBAL');
exception when duplicate_object then null; end $$;

create table if not exists leads (
  id            uuid primary key default uuid_generate_v4(),
  phone         text not null unique,
  name          text,
  source        text,
  status        lead_status not null default 'new',
  first_msg     text,
  last_msg_at   timestamptz,
  program_interest text,
  market        market_code not null default 'GLOBAL',
  created_at    timestamptz not null default now()
);
create index if not exists leads_status_idx     on leads(status);
create index if not exists leads_last_msg_idx   on leads(last_msg_at);

-- ============================================================
-- CLIENTS
-- ============================================================
do $$ begin
  create type client_status as enum ('active','paused','completed','refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type program_code as enum (
    '6wk_gym','6wk_home','12wk','pcos','40plus','zoom_trial','zoom_pack'
  );
exception when duplicate_object then null; end $$;

create table if not exists clients (
  id                  uuid primary key default uuid_generate_v4(),
  lead_id             uuid references leads(id) on delete set null,
  phone               text not null unique,
  name                text,
  email               text,
  program             program_code not null,
  program_started_at  timestamptz not null default now(),
  program_ends_at     timestamptz,
  paid_amount         numeric(10,2),
  checkout_id         text,
  folder_url          text,
  status              client_status not null default 'active',
  created_at          timestamptz not null default now()
);
create index if not exists clients_status_idx  on clients(status);
create index if not exists clients_program_idx on clients(program);

-- ============================================================
-- WEEKLY CHECK-INS
-- ============================================================
create table if not exists checkins (
  id                 uuid primary key default uuid_generate_v4(),
  client_id          uuid not null references clients(id) on delete cascade,
  week_no            integer not null,
  form_submitted_at  timestamptz,
  weight             numeric(6,2),
  waist              numeric(6,2),
  compliance_score   smallint check (compliance_score between 1 and 10),
  energy             smallint check (energy between 1 and 10),
  issues             text,
  photos_urls        text[] default '{}',
  next_week_focus    text,
  created_at         timestamptz not null default now(),
  unique (client_id, week_no)
);
create index if not exists checkins_client_idx on checkins(client_id);

-- ============================================================
-- WEEKLY GENERATED PROGRAMS
-- ============================================================
create table if not exists programs (
  id                uuid primary key default uuid_generate_v4(),
  client_id         uuid not null references clients(id) on delete cascade,
  week_no           integer not null,
  generated_at      timestamptz not null default now(),
  pdf_url           text,
  whatsapp_sent_at  timestamptz,
  workout_plan      jsonb,
  nutrition_plan    jsonb,
  notes             text,
  flagged_for_review boolean not null default false,
  flag_reason       text,
  unique (client_id, week_no)
);
create index if not exists programs_client_idx on programs(client_id);

-- ============================================================
-- MESSAGE AUDIT TRAIL
-- ============================================================
do $$ begin
  create type message_direction as enum ('in','out');
exception when duplicate_object then null; end $$;

create table if not exists messages (
  id            uuid primary key default uuid_generate_v4(),
  phone         text not null,
  direction     message_direction not null,
  body          text,
  template_name text,
  sent_at       timestamptz not null default now(),
  status        text,
  meta          jsonb
);
create index if not exists messages_phone_idx   on messages(phone, sent_at desc);
create index if not exists messages_sent_at_idx on messages(sent_at desc);

-- ============================================================
-- ESCALATIONS (human-in-the-loop queue)
-- ============================================================
create table if not exists escalations (
  id          uuid primary key default uuid_generate_v4(),
  phone       text,
  lead_id     uuid references leads(id) on delete set null,
  client_id   uuid references clients(id) on delete set null,
  trigger     text not null,
  context     text,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists escalations_open_idx on escalations(resolved, created_at desc);

-- ============================================================
-- ROW LEVEL SECURITY (lock everything, service role bypasses)
-- ============================================================
alter table leads        enable row level security;
alter table clients      enable row level security;
alter table checkins     enable row level security;
alter table programs     enable row level security;
alter table messages     enable row level security;
alter table escalations  enable row level security;

-- Admin dashboard reads via the anon key + Supabase auth.
-- Allow read for emails listed in the `admin_emails` table.
create table if not exists admin_emails (
  email text primary key
);

create or replace function public.is_admin() returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from admin_emails
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;

do $$ begin
  create policy "admin read leads"        on leads       for select using (is_admin());
  create policy "admin read clients"      on clients     for select using (is_admin());
  create policy "admin read checkins"     on checkins    for select using (is_admin());
  create policy "admin read programs"     on programs    for select using (is_admin());
  create policy "admin read messages"     on messages    for select using (is_admin());
  create policy "admin read escalations"  on escalations for select using (is_admin());
  create policy "admin write escalations" on escalations for update using (is_admin());
exception when duplicate_object then null; end $$;
