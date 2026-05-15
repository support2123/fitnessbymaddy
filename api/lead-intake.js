const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    lead_id,
    name,
    email,
    age,
    gender,
    goal,
    injuries,
    medical_conditions,
    diet_preference,
    training_experience,
    available_days,
    equipment_access,
    current_weight,
    target_weight,
    height,
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

  const { data: lead, error: leadErr } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });

  await db.from('leads').update({
    name: name || lead.name,
    intake_data: {
      email,
      age,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      training_experience,
      available_days,
      equipment_access,
      current_weight,
      target_weight,
      height,
      submitted_at: new Date().toISOString(),
    },
  }).eq('id', lead_id);

  return res.status(200).json({ success: true, message: 'Intake form submitted' });
};
