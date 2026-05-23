const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      height,
      current_weight,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_experience,
      available_equipment,
      weekly_schedule,
      wake_time,
      sleep_time
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    // Update lead with name
    const { error: leadErr } = await db.from('leads').update({
      name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    if (leadErr) {
      return res.status(400).json({ error: 'Lead not found' });
    }

    // Store intake data as a metadata object in leads (or a dedicated table)
    // For now, store as a JSON note in the first_msg field update
    const intakeData = {
      age, gender, height, current_weight,
      goal, injuries, medical_conditions,
      diet_preference, workout_experience,
      available_equipment, weekly_schedule,
      wake_time, sleep_time, email, phone,
      submitted_at: new Date().toISOString()
    };

    await db.from('leads').update({
      name,
      first_msg: JSON.stringify(intakeData)
    }).eq('id', lead_id);

    return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
