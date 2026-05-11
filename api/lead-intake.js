const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_preference, workout_days, equipment,
    medical_conditions, current_activity_level
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

  const { data: lead } = await db.from('leads').select('*').eq('id', lead_id).single();
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  await db.from('leads').update({
    name: name || lead.name,
    status: lead.status === 'new' ? 'qualified' : lead.status,
  }).eq('id', lead_id);

  const { data: client, error } = await db.from('clients').upsert({
    lead_id,
    phone: lead.phone,
    name: name || lead.name,
    email,
    intake_data: {
      age, gender, height, weight, goal, injuries,
      diet_preference, workout_days, equipment,
      medical_conditions, current_activity_level
    },
    status: 'pending',
  }, { onConflict: 'lead_id' }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ success: true, client_id: client.id });
};
