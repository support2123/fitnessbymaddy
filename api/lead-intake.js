const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions,
      diet_preference, workout_experience,
      available_days, equipment_access,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const { data, error } = await supabase.from('intake_submissions').insert({
      lead_id: lead_id || null,
      phone: phone || null,
      name,
      email: email || null,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_experience,
      available_days: available_days ? parseInt(available_days) : null,
      equipment_access,
    }).select().single();

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake form' });
    }

    if (lead_id) {
      await supabase.from('leads').update({
        name,
        last_msg_at: new Date().toISOString(),
      }).eq('id', lead_id);
    }

    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
