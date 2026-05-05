const { getSupabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_preference, training_days,
    wake_time, sleep_time, supplements, medical_conditions,
    photos
  } = req.body;

  if (!lead_id) {
    return res.status(400).json({ error: 'Missing lead_id' });
  }

  const { data: lead } = await db.from('leads').select('*').eq('id', lead_id).single();
  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  await db.from('leads').update({
    name: name || lead.name,
    status: lead.status === 'new' ? 'qualified' : lead.status
  }).eq('id', lead_id);

  const { error } = await db.from('lead_intake').upsert({
    lead_id,
    name,
    email,
    age: parseInt(age) || null,
    gender,
    height,
    weight: parseFloat(weight) || null,
    goal,
    injuries,
    diet_preference,
    training_days: parseInt(training_days) || null,
    wake_time,
    sleep_time,
    supplements,
    medical_conditions,
    photos: photos || [],
    submitted_at: new Date().toISOString()
  });

  if (error) {
    console.error('[INTAKE] DB error:', error.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }

  return res.status(200).json({ success: true });
};
