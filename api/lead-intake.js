const { supabase } = require('./_lib/supabase');
const { needsEscalation, getEscalationReason, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, phone, name, email, age, gender,
      height_cm, weight_kg, goal, injuries, medical_conditions,
      diet_preference, workout_days_per_week, gym_or_home,
      wake_time, sleep_time
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      const reason = getEscalationReason(medicalText);
      await escalateToMaddy(phone, reason, `Intake form: injuries="${injuries}", conditions="${medical_conditions}"`, null, lead_id);
    }

    const { data, error } = await supabase.from('intake_submissions').insert({
      lead_id: lead_id || null,
      phone,
      name,
      email,
      age: age ? parseInt(age) : null,
      gender,
      height_cm: height_cm ? parseFloat(height_cm) : null,
      weight_kg: weight_kg ? parseFloat(weight_kg) : null,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_days_per_week: workout_days_per_week ? parseInt(workout_days_per_week) : null,
      gym_or_home,
      wake_time,
      sleep_time
    }).select().single();

    if (error) throw error;

    if (lead_id) {
      await supabase.from('leads').update({ name, last_msg_at: new Date().toISOString() }).eq('id', lead_id);
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
