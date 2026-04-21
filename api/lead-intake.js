const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const {
    lead_id, name, email, age, goal, injuries,
    diet_pref, schedule, medical_conditions, experience_level,
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

  const { data: lead, error: findErr } = await db
    .from('leads')
    .select('id')
    .eq('id', lead_id)
    .single();

  if (findErr || !lead) return res.status(404).json({ error: 'Lead not found' });

  const { error } = await db.from('leads').update({
    name: name || undefined,
    intake_data: {
      email,
      age: age ? parseInt(age) : null,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      experience_level: experience_level || null,
    },
  }).eq('id', lead_id);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
};
