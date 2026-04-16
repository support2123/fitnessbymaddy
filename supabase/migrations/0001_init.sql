-- FitnessByMaddy — initial schema
-- Run: supabase db push   (or paste into Supabase SQL editor)

create extension if not exists "pgcrypto";

-- ============================================================
-- leads
-- ============================================================
create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  phone            text not null unique,
  name             text,
  source           text,
  status           text not null default 'new'
                    check (status in ('new','qualified','converted','dropped')),
  first_msg        text,
  last_msg_at      timestamptz,
  program_interest text,
  market           text check (market in ('IN','UAE','UK','GLOBAL')),
  created_at       timestamptz not null default now()
);
create index if not exists leads_status_idx       on public.leads (status);
create index if not exists leads_last_msg_at_idx  on public.leads (last_msg_at);

-- ============================================================
-- clients
-- ============================================================
create table if not exists public.clients (
  id                  uuid primary key default gen_random_uuid(),
  lead_id             uuid references public.leads(id) on delete set null,
  phone               text not null,
  name                text,
  email               text,
  program             text not null
                      check (program in ('6wk_gym','6wk_home','12wk','pcos','40plus','zoom_trial','zoom_pack')),
  program_started_at  timestamptz,
  program_ends_at     timestamptz,
  paid_amount         numeric(10,2),
  checkout_id         text,
  folder_url          text,
  status              text not null default 'active'
                      check (status in ('active','paused','completed','refunded')),
  created_at          timestamptz not null default now()
);
create index if not exists clients_status_idx  on public.clients (status);
create index if not exists clients_program_idx on public.clients (program);
create index if not exists clients_phone_idx   on public.clients (phone);
-- A client can re-enrol in the same program only once per active record
create unique index if not exists clients_phone_program_uq
  on public.clients (phone, program);

-- ============================================================
-- checkins (weekly)
-- ============================================================
create table if not exists public.checkins (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  week_no           int not null,
  form_submitted_at timestamptz,
  weight            numeric(5,2),
  waist             numeric(5,2),
  compliance_score  int check (compliance_score between 1 and 10),
  energy            int check (energy between 1 and 10),
  issues            text,
  photos_urls       text[] default '{}',
  next_week_focus   text,
  created_at        timestamptz not null default now(),
  unique (client_id, week_no)
);
create index if not exists checkins_client_idx on public.checkins (client_id);

-- ============================================================
-- programs (generated weekly for 12-week clients)
-- ============================================================
create table if not exists public.programs (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  week_no           int not null,
  generated_at      timestamptz not null default now(),
  pdf_url           text,
  whatsapp_sent_at  timestamptz,
  workout_plan      jsonb,
  nutrition_plan    jsonb,
  notes             text,
  flagged_for_review boolean default false,
  review_reason     text,
  unique (client_id, week_no)
);
create index if not exists programs_client_idx on public.programs (client_id);

-- ============================================================
-- messages (audit trail)
-- ============================================================
create table if not exists public.messages (
  id             bigserial primary key,
  phone          text not null,
  direction      text not null check (direction in ('in','out')),
  body           text,
  template_name  text,
  sent_at        timestamptz not null default now(),
  status         text,
  meta           jsonb
);
create index if not exists messages_phone_sent_idx on public.messages (phone, sent_at desc);

-- ============================================================
-- escalations (things Maddy needs to eyeball)
-- ============================================================
create table if not exists public.escalations (
  id           bigserial primary key,
  phone        text,
  client_id    uuid references public.clients(id) on delete set null,
  lead_id      uuid references public.leads(id)   on delete set null,
  reason       text not null,
  context      text,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists escalations_open_idx on public.escalations (resolved_at) where resolved_at is null;

-- ============================================================
-- RLS: lock everything down. Server uses service role and bypasses RLS.
-- Admin UI reads via anon key with a small set of policies (future).
-- ============================================================
alter table public.leads        enable row level security;
alter table public.clients      enable row level security;
alter table public.checkins     enable row level security;
alter table public.programs     enable row level security;
alter table public.messages     enable row level security;
alter table public.escalations  enable row level security;
