const { getSupabase } = require('./_lib/supabase');
const { checkEscalation, createEscalation } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, phone, email, age, gender,
      height_cm, weight_kg, goal, injuries,
      medical_conditions, diet_pref, meals_per_day,
      workout_experience, days_per_week, equipment_access, schedule
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    const escalation = checkEscalation(medicalText);
    if (escalation) {
      await createEscalation(phone || '', `Intake form: ${escalation}`, medicalText);
    }

    await db.from('intake_submissions').insert({
      lead_id, name, phone, email,
      age: age ? parseInt(age) : null,
      gender,
      height_cm: height_cm ? parseFloat(height_cm) : null,
      weight_kg: weight_kg ? parseFloat(weight_kg) : null,
      goal, injuries, medical_conditions, diet_pref,
      meals_per_day: meals_per_day ? parseInt(meals_per_day) : null,
      workout_experience,
      days_per_week: days_per_week ? parseInt(days_per_week) : null,
      equipment_access, schedule
    });

    if (name || email) {
      const updates = {};
      if (name) updates.name = name;
      await db.from('leads').update(updates).eq('id', lead_id);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
