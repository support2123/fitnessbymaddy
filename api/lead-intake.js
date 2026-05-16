const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    lead_id, name, age, gender, height, weight,
    goal, injuries, medical_conditions, diet_preference,
    workout_experience, available_days, equipment_access,
    wake_time, sleep_time, supplements, photos
  } = req.body;

  if (!lead_id) {
    return res.status(400).json({ error: 'lead_id is required' });
  }

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  await db.from('leads').update({
    name: name || lead.name,
    status: lead.status === 'new' ? 'qualified' : lead.status
  }).eq('id', lead_id);

  const { error } = await db.from('intake_forms').insert({
    lead_id,
    name,
    age: parseInt(age) || null,
    gender,
    height,
    weight: parseFloat(weight) || null,
    goal,
    injuries,
    medical_conditions,
    diet_preference,
    workout_experience,
    available_days: parseInt(available_days) || null,
    equipment_access,
    wake_time,
    sleep_time,
    supplements,
    photos: photos || [],
    submitted_at: new Date().toISOString()
  });

  if (error) {
    return res.status(500).json({ error: 'Failed to save intake form', detail: error.message });
  }

  return res.status(200).json({ success: true, message: 'Intake form submitted' });
};
