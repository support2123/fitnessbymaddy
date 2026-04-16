-- FitnessByMaddy automation schema
-- Run once against the Supabase project the backend points at.
-- Safe to re-run: every object is created with IF NOT EXISTS / OR REPLACE.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────
-- leads: every inbound WhatsApp number lands here first.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  phone            text not null unique,
  name             text,
  source           text default 'whatsapp',
  status           text not null default 'new'
                     check (status in ('new','qualified','converted','dropped')),
  first_msg        text,
  last_msg_at      timestamptz,
  program_interest text,
  market           text default 'IN'
                     check (market in ('IN','UAE','UK','GLOBAL')),
  last_outbound_at timestamptz,
  nudge_count      int not null default 0,
  opted_out        boolean not null default false,
  created_at       timestamptz not null default now()
);

create index if not exists leads_status_idx   on public.leads (status);
create index if not exists leads_lastmsg_idx  on public.leads (last_msg_at);
create index if not exists leads_market_idx   on public.leads (market);

-- ─────────────────────────────────────────────────────────────
-- clients: a lead who has paid. One row per active engagement.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.clients (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid references public.leads(id) on delete set null,
  phone              text not null,
  name               text,
  email              text,
  program            text not null
                       check (program in
                         ('6wk_gym','6wk_home','12wk','pcos','40plus',
                          'zoom_trial','zoom_pack')),
  program_started_at timestamptz not null default now(),
  program_ends_at    timestamptz,
  paid_amount        numeric(10,2),
  currency           text default 'USD',
  checkout_id        text,
  folder_url         text,
  intake_json        jsonb,
  status             text not null default 'active'
                       check (status in ('active','paused','completed','refunded')),
  created_at         timestamptz not null default now()
);

create index if not exists clients_phone_idx  on public.clients (phone);
create index if not exists clients_status_idx on public.clients (status);
create index if not exists clients_program_idx on public.clients (program);

-- ─────────────────────────────────────────────────────────────
-- checkins: weekly self-report, one row per week per client.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.checkins (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  week_no           int not null,
  form_sent_at      timestamptz,
  form_submitted_at timestamptz,
  weight            numeric(5,2),
  waist             numeric(5,2),
  compliance_score  int check (compliance_score between 1 and 10),
  energy            int check (energy between 1 and 10),
  issues            text,
  photos_urls       text[] default '{}',
  next_week_focus   text,
  nudge_count       int not null default 0,
  token             text unique,
  created_at        timestamptz not null default now(),
  unique (client_id, week_no)
);

create index if not exists checkins_client_idx on public.checkins (client_id);
create index if not exists checkins_submitted_idx on public.checkins (form_submitted_at);

-- ─────────────────────────────────────────────────────────────
-- programs: weekly generated plan, one row per week per client.
-- ─────────────────────────────────────────────────────────────
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
  flagged_for_review boolean not null default false,
  flag_reason       text,
  unique (client_id, week_no)
);

create index if not exists programs_client_idx on public.programs (client_id);
create index if not exists programs_flagged_idx on public.programs (flagged_for_review)
  where flagged_for_review = true;

-- ─────────────────────────────────────────────────────────────
-- messages: append-only WhatsApp audit trail.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  phone         text not null,
  direction     text not null check (direction in ('in','out')),
  body          text,
  template_name text,
  provider      text default 'aisensy',
  provider_id   text,
  sent_at       timestamptz not null default now(),
  status        text default 'queued'
                  check (status in ('queued','sent','delivered','read','failed'))
);

create index if not exists messages_phone_idx on public.messages (phone, sent_at desc);
create index if not exists messages_status_idx on public.messages (status);

-- ─────────────────────────────────────────────────────────────
-- escalations: human-in-the-loop queue for Maddy.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.escalations (
  id          uuid primary key default gen_random_uuid(),
  phone       text,
  lead_id     uuid references public.leads(id)   on delete set null,
  client_id   uuid references public.clients(id) on delete set null,
  reason      text not null,
  payload     jsonb,
  resolved    boolean not null default false,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists escalations_open_idx on public.escalations (resolved, created_at desc)
  where resolved = false;

-- ─────────────────────────────────────────────────────────────
-- Helper: view for admin dashboard KPIs.
-- ─────────────────────────────────────────────────────────────
create or replace view public.dashboard_kpis as
select
  (select count(*) from public.leads    where created_at::date = current_date) as leads_today,
  (select count(*) from public.leads    where created_at >= now() - interval '7 days') as leads_7d,
  (select count(*) from public.clients  where status = 'active') as active_clients,
  (select count(*) from public.checkins where form_sent_at is not null and form_submitted_at is null) as pending_checkins,
  (select count(*) from public.programs where generated_at >= now() - interval '7 days') as programs_7d,
  (select count(*) from public.escalations where resolved = false) as open_escalations,
  case
    when (select count(*) from public.leads where created_at >= now() - interval '30 days') = 0 then 0
    else round(
      100.0 *
      (select count(*) from public.clients where created_at >= now() - interval '30 days') /
      (select count(*) from public.leads   where created_at >= now() - interval '30 days'),
    2)
  end as conversion_pct_30d;

-- ─────────────────────────────────────────────────────────────
-- Row-level security. All writes go through service_role from
-- serverless functions; admin dashboard reads via authed role.
-- ─────────────────────────────────────────────────────────────
alter table public.leads        enable row level security;
alter table public.clients      enable row level security;
alter table public.checkins     enable row level security;
alter table public.programs     enable row level security;
alter table public.messages     enable row level security;
alter table public.escalations  enable row level security;

-- Service role bypasses RLS automatically — policies below are
-- for authenticated admin users (Maddy) reading via the dashboard.
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'admin_read_leads') then
    create policy admin_read_leads       on public.leads        for select to authenticated using (true);
    create policy admin_read_clients     on public.clients      for select to authenticated using (true);
    create policy admin_read_checkins    on public.checkins     for select to authenticated using (true);
    create policy admin_read_programs    on public.programs     for select to authenticated using (true);
    create policy admin_read_messages    on public.messages     for select to authenticated using (true);
    create policy admin_read_escalations on public.escalations  for select to authenticated using (true);
    create policy admin_resolve_escalations on public.escalations for update to authenticated
      using (true) with check (true);
  end if;
end $$;
