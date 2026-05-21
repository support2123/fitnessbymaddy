-- FitnessByMaddy Database Schema
-- Run in Supabase SQL editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- LEADS TABLE
create table if not exists leads (
  id uuid primary key default uuid_generate_v4(),
  phone text not null,
  name text,
  source text default 'whatsapp',
  status text not null default 'new' check (status in ('new', 'qualified', 'converted', 'dropped')),
  first_msg text,
  last_msg_at timestamptz default now(),
  program_interest text,
  market text default 'GLOBAL' check (market in ('IN', 'UAE', 'UK', 'GLOBAL')),
  created_at timestamptz default now()
);

create index idx_leads_phone on leads(phone);
create index idx_leads_status on leads(status);

-- CLIENTS TABLE
create table if not exists clients (
  id uuid primary key default uuid_generate_v4(),
  lead_id uuid references leads(id),
  phone text not null,
  name text,
  email text,
  program text not null check (program in ('6wk_gym', '6wk_home', '12wk', 'pcos', '40plus', 'zoom_trial', 'zoom_pack')),
  program_started_at timestamptz default now(),
  program_ends_at timestamptz,
  paid_amount integer,
  checkout_id text,
  folder_url text,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'refunded')),
  age integer,
  goal text,
  injuries text,
  diet_pref text,
  schedule text,
  created_at timestamptz default now()
);

create index idx_clients_phone on clients(phone);
create index idx_clients_status on clients(status);

-- CHECKINS TABLE (weekly)
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
  photos_urls text[] default '{}',
  next_week_focus text,
  created_at timestamptz default now()
);

create index idx_checkins_client on checkins(client_id);

-- PROGRAMS TABLE (generated weekly per client)
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

create index idx_programs_client on programs(client_id);

-- MESSAGES TABLE (audit trail)
create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  phone text not null,
  direction text not null check (direction in ('in', 'out')),
  body text,
  template_name text,
  sent_at timestamptz default now(),
  status text default 'sent'
);

create index idx_messages_phone on messages(phone);
create index idx_messages_sent on messages(sent_at);

-- ESCALATIONS TABLE (for admin dashboard)
create table if not exists escalations (
  id uuid primary key default uuid_generate_v4(),
  phone text not null,
  client_id uuid references clients(id),
  reason text not null,
  message_body text,
  resolved boolean default false,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

create index idx_escalations_resolved on escalations(resolved);

-- Row Level Security (basic - service key bypasses)
alter table leads enable row level security;
alter table clients enable row level security;
alter table checkins enable row level security;
alter table programs enable row level security;
alter table messages enable row level security;
alter table escalations enable row level security;
