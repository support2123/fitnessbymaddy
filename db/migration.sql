-- FitnessByMaddy automation pipeline — Supabase migration
-- Run this in the Supabase SQL Editor

-- LEADS
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  name text,
  source text default 'whatsapp',
  status text not null default 'new' check (status in ('new','qualified','converted','dropped')),
  first_msg text,
  last_msg_at timestamptz,
  program_interest text,
  market text default 'GLOBAL' check (market in ('IN','UAE','UK','GLOBAL')),
  created_at timestamptz default now()
);

create index if not exists idx_leads_phone on leads(phone);
create index if not exists idx_leads_status on leads(status);

-- CLIENTS
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  phone text not null,
  name text,
  email text,
  program text check (program in ('6wk_gym','6wk_home','12wk','pcos','40plus','zoom_trial','zoom_pack')),
  program_started_at timestamptz,
  program_ends_at timestamptz,
  paid_amount integer,
  checkout_id text,
  folder_url text,
  status text not null default 'active' check (status in ('active','paused','completed','refunded')),
  created_at timestamptz default now()
);

create index if not exists idx_clients_phone on clients(phone);
create index if not exists idx_clients_status on clients(status);

-- CHECKINS (weekly)
create table if not exists checkins (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  week_no integer not null,
  form_submitted_at timestamptz default now(),
  weight numeric,
  waist numeric,
  compliance_score integer check (compliance_score between 1 and 10),
  energy integer check (energy between 1 and 10),
  issues text,
  photos_urls text[] default '{}',
  next_week_focus text
);

create index if not exists idx_checkins_client on checkins(client_id, week_no);

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
  notes text
);

create index if not exists idx_programs_client on programs(client_id, week_no);

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

create index if not exists idx_messages_phone on messages(phone, sent_at);

-- Enable Row Level Security (service key bypasses, but good practice)
alter table leads enable row level security;
alter table clients enable row level security;
alter table checkins enable row level security;
alter table programs enable row level security;
alter table messages enable row level security;

-- Storage bucket for client files
insert into storage.buckets (id, name, public)
values ('clients', 'clients', false)
on conflict (id) do nothing;
