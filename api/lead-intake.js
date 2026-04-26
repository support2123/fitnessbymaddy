const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, notifyMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, phone, email, age, gender,
      height_cm, current_weight, target_weight, goal,
      injuries, medical_conditions, diet_preference,
      workout_experience, available_equipment,
      days_per_week, preferred_time
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const sb = getSupabase();

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await notifyMaddy('medical_flag_intake', { name, goal, injuries, medical_conditions });
    }

    const { data, error } = await sb.from('intake_forms').insert({
      lead_id: lead_id || null,
      name,
      phone,
      email,
      age: age ? parseInt(age) : null,
      gender,
      height_cm: height_cm ? parseFloat(height_cm) : null,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_experience,
      available_equipment,
      days_per_week: days_per_week ? parseInt(days_per_week) : null,
      preferred_time
    }).select().single();

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake form' });
    }

    if (lead_id) {
      await sb.from('leads').update({ name }).eq('id', lead_id);
    }

    return res.status(200).json({ success: true, intake_id: data.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
