const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions,
      diet_preference, workout_schedule, experience_level,
      current_weight, target_weight,
    } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const submission = {
      lead_id: lead_id || null,
      name,
      email,
      phone: phone || null,
      age: age ? parseInt(age, 10) : null,
      gender: gender || null,
      goal: goal || null,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference: diet_preference || null,
      workout_schedule: workout_schedule || null,
      experience_level: experience_level || null,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      submitted_at: new Date().toISOString(),
    };

    const { data, error } = await db.from('intake_submissions').insert(submission).select().single();

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save submission' });
    }

    if (lead_id) {
      await db.from('leads').update({ name, last_msg_at: new Date().toISOString() }).eq('id', lead_id);
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
