const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_preference, schedule, medical_conditions,
    current_activity, motivation,
  } = req.body || {};

  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  await db.from('leads').update({
    name: name || lead.name,
    status: lead.status === 'new' ? 'qualified' : lead.status,
  }).eq('id', lead_id);

  const intakeData = {
    age, gender, height, weight, goal, injuries,
    diet_preference, schedule, medical_conditions,
    current_activity, motivation, email,
    submitted_at: new Date().toISOString(),
  };

  const { error } = await db.rpc('update_lead_metadata', {
    p_lead_id: lead_id,
    p_metadata: intakeData,
  }).catch(() => {
    return db.from('leads').update({
      first_msg: JSON.stringify(intakeData),
    }).eq('id', lead_id);
  });

  return res.status(200).json({ success: true, lead_id });
};
