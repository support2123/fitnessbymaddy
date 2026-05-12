const { createClient } = require('@supabase/supabase-js');

let client;

function getSupabase() {
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }
  return client;
}

const SCHEMA = {
  leads: `create table if not exists leads (
    id uuid primary key default gen_random_uuid(),
    phone text not null,
    name text,
    source text default 'whatsapp',
    status text default 'new' check (status in ('new','qualified','converted','dropped')),
    first_msg text,
    last_msg_at timestamptz,
    program_interest text,
    market text default 'GLOBAL' check (market in ('IN','UAE','UK','GLOBAL')),
    created_at timestamptz default now()
  )`,
  clients: `create table if not exists clients (
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
    status text default 'active' check (status in ('active','paused','completed','refunded')),
    created_at timestamptz default now()
  )`,
  checkins: `create table if not exists checkins (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references clients(id),
    week_no integer not null,
    form_submitted_at timestamptz default now(),
    weight numeric,
    waist numeric,
    compliance_score integer check (compliance_score between 1 and 10),
    energy integer check (energy between 1 and 10),
    issues text,
    photos_urls jsonb default '[]'::jsonb,
    next_week_focus text
  )`,
  programs: `create table if not exists programs (
    id uuid primary key default gen_random_uuid(),
    client_id uuid references clients(id),
    week_no integer not null,
    generated_at timestamptz default now(),
    pdf_url text,
    whatsapp_sent_at timestamptz,
    workout_plan jsonb,
    nutrition_plan jsonb,
    notes text
  )`,
  messages: `create table if not exists messages (
    id uuid primary key default gen_random_uuid(),
    phone text not null,
    direction text check (direction in ('in','out')),
    body text,
    template_name text,
    sent_at timestamptz default now(),
    status text default 'sent'
  )`
};

async function ensureTables() {
  const db = getSupabase();
  for (const [name, sql] of Object.entries(SCHEMA)) {
    await db.rpc('exec_sql', { sql }).catch(() => {});
  }
}

module.exports = { getSupabase, ensureTables, SCHEMA };
