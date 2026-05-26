const { getSupabase } = require('../lib/supabase');
const { needsEscalation, createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, age, gender, height_cm, weight_kg,
      goal, injuries, medical_conditions, diet_preference,
      workout_days_per_week, gym_access, schedule_preference,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db.from('leads').select('*').eq('id', lead_id).single();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await createEscalation(lead.phone, 'medical_condition_in_intake', medicalText, null);
    }

    const { error } = await db.from('intake_forms').insert({
      lead_id,
      age: age ? parseInt(age, 10) : null,
      gender,
      height_cm: height_cm ? parseFloat(height_cm) : null,
      weight_kg: weight_kg ? parseFloat(weight_kg) : null,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference,
      workout_days_per_week: workout_days_per_week ? parseInt(workout_days_per_week, 10) : null,
      gym_access: gym_access === 'true' || gym_access === true,
      schedule_preference,
    });

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.json({ success: true, message: 'Intake form saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
