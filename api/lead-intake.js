const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, age, gender, height_cm, weight_kg,
      goal, injuries, medical_conditions, diet_preference,
      meals_per_day, workout_days_per_week, gym_access,
      equipment_available, wake_time, sleep_time, occupation,
      stress_level,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const medicalText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      const { data: lead } = await db.from('leads').select('phone').eq('id', lead_id).single();
      await escalateToMaddy({
        reason: 'Medical condition in intake form',
        phone: lead?.phone || 'unknown',
        details: medicalText,
      });
    }

    await db.from('intake_forms').insert({
      lead_id,
      age: age ? parseInt(age) : null,
      gender,
      height_cm: height_cm ? parseFloat(height_cm) : null,
      weight_kg: weight_kg ? parseFloat(weight_kg) : null,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference: diet_preference || null,
      meals_per_day: meals_per_day ? parseInt(meals_per_day) : null,
      workout_days_per_week: workout_days_per_week ? parseInt(workout_days_per_week) : null,
      gym_access: gym_access === 'true' || gym_access === true,
      equipment_available: equipment_available || null,
      wake_time: wake_time || null,
      sleep_time: sleep_time || null,
      occupation: occupation || null,
      stress_level: stress_level ? parseInt(stress_level) : null,
    });

    if (name || email) {
      const updates = {};
      if (name) updates.name = name;
      await db.from('leads').update(updates).eq('id', lead_id);
    }

    return res.json({ success: true });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
