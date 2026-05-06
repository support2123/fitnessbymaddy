const { getSupabase } = require('./_lib/supabase');
const { corsHeaders } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const {
    lead_id, name, email, age, goal, injuries,
    diet_pref, schedule, phone
  } = req.body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'lead_id or phone required' });
  }

  let lead;
  if (lead_id) {
    const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
    lead = data;
  } else {
    const { data } = await db.from('leads').select('*').eq('phone', phone).single();
    lead = data;
  }

  if (!lead) {
    return res.status(404).json({ error: 'lead not found' });
  }

  if (name) {
    await db.from('leads').update({ name }).eq('id', lead.id);
  }

  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('phone', lead.phone)
    .single();

  if (existingClient) {
    await db.from('clients').update({
      name: name || existingClient.name,
      email,
      age: age ? parseInt(age, 10) : null,
      goal,
      injuries,
      diet_pref,
      schedule
    }).eq('id', existingClient.id);

    return res.status(200).json({ ok: true, client_id: existingClient.id, updated: true });
  }

  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead.id,
    phone: lead.phone,
    name: name || lead.name,
    email,
    program: lead.program_interest,
    age: age ? parseInt(age, 10) : null,
    goal,
    injuries,
    diet_pref,
    schedule
  }).select().single();

  if (error) {
    console.error('[Intake] Insert error:', error.message);
    return res.status(500).json({ error: 'failed to save' });
  }

  return res.status(200).json({ ok: true, client_id: client.id });
};
