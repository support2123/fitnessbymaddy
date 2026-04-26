-- FitnessByMaddy — Supabase schema
-- Run this in the Supabase SQL editor to create all tables

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

-- CLIENTS
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id),
  phone text not null,
  name text,
  email text,
  program text check (program in ('6wk_gym','6wk_home','12wk','pcos','40plus','zoom_trial','zoom_pack')),
  program_started_at timestamptz default now(),
  program_ends_at timestamptz,
  paid_amount integer,
  checkout_id text,
  folder_url text,
  status text not null default 'active' check (status in ('active','paused','completed','refunded')),
  created_at timestamptz default now()
);

-- CHECKINS (weekly)
create table if not exists checkins (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) not null,
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
create unique index if not exists checkins_client_week_idx on checkins(client_id, week_no);

-- PROGRAMS (generated weekly per client)
create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) not null,
  week_no integer not null,
  generated_at timestamptz default now(),
  pdf_url text,
  whatsapp_sent_at timestamptz,
  workout_plan jsonb,
  nutrition_plan jsonb,
  notes text,
  created_at timestamptz default now()
);

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
create index if not exists messages_sent_at_idx on messages(sent_at desc);

-- ROW LEVEL SECURITY (enable but allow service key full access)
alter table leads enable row level security;
alter table clients enable row level security;
alter table checkins enable row level security;
alter table programs enable row level security;
alter table messages enable row level security;

-- Service role policies (serverless functions use service key)
create policy "Service full access on leads" on leads for all using (true) with check (true);
create policy "Service full access on clients" on clients for all using (true) with check (true);
create policy "Service full access on checkins" on checkins for all using (true) with check (true);
create policy "Service full access on programs" on programs for all using (true) with check (true);
create policy "Service full access on messages" on messages for all using (true) with check (true);

-- STORAGE BUCKET for client files (PDFs, photos)
insert into storage.buckets (id, name, public) values ('clients', 'clients', false) on conflict do nothing;
