const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    lead_id, name, email, phone, age, gender,
    goal, injuries, diet_pref, schedule,
    experience_level, medical_conditions,
  } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }

  const db = getSupabase();

  try {
    if (lead_id) {
      await db.from('leads').update({
        name,
        last_msg_at: new Date().toISOString(),
      }).eq('id', lead_id);
    }

    const { data, error } = await db.from('intake_submissions').insert({
      lead_id: lead_id || null,
      name,
      email,
      phone: phone || null,
      age: age ? parseInt(age) : null,
      gender: gender || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      experience_level: experience_level || null,
      medical_conditions: medical_conditions || null,
      submitted_at: new Date().toISOString(),
    }).select().single();

    if (error) throw error;

    return res.status(200).json({ status: 'ok', id: data.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
