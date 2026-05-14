const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_pref, schedule, experience,
    medical_conditions, photos
  } = req.body || {};

  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

  const { data: lead } = await db.from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  await db.from('leads').update({
    name: name || lead.name,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead_id);

  const intakeData = {
    lead_id,
    name,
    email,
    age: parseInt(age) || null,
    gender,
    height,
    weight: parseFloat(weight) || null,
    goal,
    injuries: injuries || null,
    diet_pref: diet_pref || null,
    schedule: schedule || null,
    experience: experience || null,
    medical_conditions: medical_conditions || null,
    photos: photos || [],
    submitted_at: new Date().toISOString()
  };

  const bucket = db.storage.from('intake-forms');
  const filePath = `leads/${lead_id}/intake.json`;
  await bucket.upload(filePath, JSON.stringify(intakeData, null, 2), {
    contentType: 'application/json',
    upsert: true
  });

  return res.status(200).json({ ok: true, message: 'Intake form saved' });
};
