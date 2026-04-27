-- FitnessByMaddy Automation Schema
-- Run this in Supabase SQL Editor

-- LEADS
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  name text,
  source text default 'whatsapp',
  status text not null default 'new' check (status in ('new','qualified','converted','dropped')),
  first_msg text,
  last_msg_at timestamptz default now(),
  program_interest text,
  market text default 'GLOBAL' check (market in ('IN','UAE','UK','GLOBAL')),
  created_at timestamptz default now()
);

create unique index if not exists leads_phone_idx on leads(phone);
create index if not exists leads_status_idx on leads(status);
create index if not exists leads_created_at_idx on leads(created_at);

-- CLIENTS
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  phone text not null,
  name text,
  email text,
  program text not null check (program in ('6wk_gym','6wk_home','12wk','pcos','40plus','zoom_trial','zoom_pack')),
  program_started_at timestamptz default now(),
  program_ends_at timestamptz,
  paid_amount integer default 0,
  checkout_id text,
  folder_url text,
  status text not null default 'active' check (status in ('active','paused','completed','refunded')),
  created_at timestamptz default now()
);

create index if not exists clients_phone_idx on clients(phone);
create index if not exists clients_status_idx on clients(status);
create index if not exists clients_lead_id_idx on clients(lead_id);

-- CHECKINS (weekly)
create table if not exists checkins (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  week_no integer not null,
  form_submitted_at timestamptz,
  weight numeric,
  waist numeric,
  compliance_score integer check (compliance_score between 1 and 10),
  energy integer check (energy between 1 and 10),
  issues text,
  photos_urls text[] default '{}',
  next_week_focus text,
  nudge_count integer default 0,
  created_at timestamptz default now()
);

create unique index if not exists checkins_client_week_idx on checkins(client_id, week_no);
create index if not exists checkins_submitted_idx on checkins(form_submitted_at);

-- PROGRAMS (generated weekly per client)
create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
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

create unique index if not exists programs_client_week_idx on programs(client_id, week_no);

-- MESSAGES (audit trail)
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  direction text not null check (direction in ('in','out')),
  body text,
  template_name text,
  sent_at timestamptz default now(),
  status text default 'sent'
);

create index if not exists messages_phone_idx on messages(phone);
create index if not exists messages_sent_at_idx on messages(sent_at);

-- STORAGE BUCKET for client files
insert into storage.buckets (id, name, public)
values ('client-files', 'client-files', false)
on conflict (id) do nothing;

-- Storage policy: service role only
create policy "Service role full access" on storage.objects
  for all using (bucket_id = 'client-files')
  with check (bucket_id = 'client-files');
