const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, age, gender, phone, email,
      height_cm, weight_kg, goal, injuries,
      medical_conditions, diet_preference,
      meals_per_day, workout_days_per_week,
      gym_access, schedule_preference
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const db = getSupabase();

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy(
        'Medical flag on intake form',
        phone,
        `Injuries: ${injuries || 'none'} | Medical: ${medical_conditions || 'none'}`
      );
    }

    const { data, error } = await db.from('intake_forms').insert({
      lead_id: lead_id || null,
      name,
      age: age ? parseInt(age) : null,
      gender,
      phone,
      email,
      height_cm: height_cm ? parseFloat(height_cm) : null,
      weight_kg: weight_kg ? parseFloat(weight_kg) : null,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference,
      meals_per_day: meals_per_day ? parseInt(meals_per_day) : null,
      workout_days_per_week: workout_days_per_week ? parseInt(workout_days_per_week) : null,
      gym_access: gym_access !== 'false' && gym_access !== false,
      schedule_preference
    }).select('id').single();

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake form' });
    }

    if (lead_id) {
      await db.from('leads').update({
        name,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead_id);
    }

    return res.status(200).json({ ok: true, intake_id: data.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
