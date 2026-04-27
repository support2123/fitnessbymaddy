import supabase from '../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    lead_id, name, age, phone, email, goal, injuries,
    diet_pref, schedule, training_experience, medical_conditions,
  } = req.body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'lead_id or phone required' });
  }

  const updateData = {
    last_msg_at: new Date().toISOString(),
  };
  if (name) updateData.name = name;

  let query;
  if (lead_id) {
    query = supabase.from('leads').update(updateData).eq('id', lead_id);
  } else {
    query = supabase.from('leads').update(updateData).eq('phone', phone);
  }
  await query;

  const intakeRecord = {
    lead_id: lead_id || null,
    phone: phone || null,
    name, age, email, goal, injuries,
    diet_pref, schedule, training_experience, medical_conditions,
    submitted_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('lead_intakes')
    .upsert(intakeRecord, { onConflict: 'lead_id' })
    .select();

  if (error && error.code === '42P01') {
    await supabase.rpc('exec_sql', {
      sql: `create table if not exists lead_intakes (
        id uuid primary key default gen_random_uuid(),
        lead_id uuid references leads(id),
        phone text,
        name text, age int, email text, goal text,
        injuries text, diet_pref text, schedule text,
        training_experience text, medical_conditions text,
        submitted_at timestamptz default now()
      )`,
    });
    await supabase.from('lead_intakes').insert(intakeRecord);
  }

  return res.status(200).json({ ok: true, message: 'Intake submitted' });
}
