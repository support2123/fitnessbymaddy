const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const data = req.body;

  if (!data.lead_id) {
    return res.status(400).json({ error: 'lead_id is required' });
  }

  const { data: lead, error: leadErr } = await db
    .from('leads')
    .select('*')
    .eq('id', data.lead_id)
    .single();

  if (leadErr || !lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  const intakeData = {
    name: data.name,
    age: data.age,
    gender: data.gender,
    height: data.height,
    weight: data.weight,
    goal: data.goal,
    injuries: data.injuries,
    medical_conditions: data.medical_conditions,
    diet_preference: data.diet_preference,
    training_experience: data.training_experience,
    equipment_access: data.equipment_access,
    days_per_week: data.days_per_week,
    preferred_time: data.preferred_time,
    allergies: data.allergies,
    supplements: data.supplements,
    sleep_hours: data.sleep_hours,
    stress_level: data.stress_level,
    additional_notes: data.additional_notes
  };

  await db.from('intake_forms').insert({
    lead_id: data.lead_id,
    data: intakeData
  });

  if (data.name) {
    await db.from('leads').update({ name: data.name }).eq('id', data.lead_id);
  }

  return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });
};
