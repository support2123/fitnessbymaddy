-- FitnessByMaddy — Supabase schema
-- Run this in the Supabase SQL editor to create all tables.

-- Leads: every new WhatsApp contact
create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  phone         text not null unique,
  name          text,
  source        text default 'whatsapp',
  status        text not null default 'new'
                  check (status in ('new','qualified','converted','dropped')),
  first_msg     text,
  last_msg_at   timestamptz,
  program_interest text,
  market        text default 'GLOBAL'
                  check (market in ('IN','UAE','UK','GLOBAL')),
  created_at    timestamptz default now()
);

create index if not exists idx_leads_phone on leads(phone);
create index if not exists idx_leads_status on leads(status);

-- Clients: converted leads with active programs
create table if not exists clients (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid references leads(id),
  phone           text not null,
  name            text,
  email           text,
  program         text not null
                    check (program in (
                      '6wk_gym','6wk_home','12wk','pcos','40plus',
                      'zoom_trial','zoom_pack'
                    )),
  program_started_at timestamptz default now(),
  program_ends_at    timestamptz,
  paid_amount     numeric(10,2),
  checkout_id     text,
  folder_url      text,
  status          text not null default 'active'
                    check (status in ('active','paused','completed','refunded')),
  created_at      timestamptz default now()
);

create index if not exists idx_clients_phone on clients(phone);
create index if not exists idx_clients_status on clients(status);

-- Weekly check-ins
create table if not exists checkins (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references clients(id) not null,
  week_no          int not null,
  form_submitted_at timestamptz default now(),
  weight           numeric(5,1),
  waist            numeric(5,1),
  compliance_score int check (compliance_score between 1 and 10),
  energy           int check (energy between 1 and 10),
  issues           text,
  photos_urls      text[] default '{}',
  next_week_focus  text,
  created_at       timestamptz default now(),
  unique(client_id, week_no)
);

-- Generated weekly programs (12-week clients)
create table if not exists programs (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references clients(id) not null,
  week_no         int not null,
  generated_at    timestamptz default now(),
  pdf_url         text,
  whatsapp_sent_at timestamptz,
  workout_plan    jsonb,
  nutrition_plan  jsonb,
  notes           text,
  created_at      timestamptz default now(),
  unique(client_id, week_no)
);

-- Message audit trail
create table if not exists messages (
  id            uuid primary key default gen_random_uuid(),
  phone         text not null,
  direction     text not null check (direction in ('in','out')),
  body          text,
  template_name text,
  sent_at       timestamptz default now(),
  status        text default 'sent'
);

create index if not exists idx_messages_phone on messages(phone);
create index if not exists idx_messages_sent_at on messages(sent_at);

-- Lead intake form submissions
create table if not exists lead_intakes (
  id                  uuid primary key default gen_random_uuid(),
  lead_id             uuid references leads(id),
  phone               text,
  name                text,
  age                 int,
  email               text,
  goal                text,
  injuries            text,
  diet_pref           text,
  schedule            text,
  training_experience text,
  medical_conditions  text,
  submitted_at        timestamptz default now()
);

create unique index if not exists idx_lead_intakes_lead on lead_intakes(lead_id);

-- Row Level Security (optional — enable per table as needed)
-- alter table leads enable row level security;
-- alter table clients enable row level security;

-- Storage bucket for client files (run via Supabase dashboard or API)
-- insert into storage.buckets (id, name, public)
-- values ('clients', 'clients', false);
