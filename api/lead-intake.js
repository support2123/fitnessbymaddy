const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const {
      lead_id, phone, name, age, gender, goal, injuries,
      medical_conditions, diet_preference, workout_days,
      workout_location, wake_time, sleep_time,
      current_weight, target_weight, height,
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const db = getSupabase();

    const { data: submission, error } = await db.from('intake_submissions').insert({
      lead_id: lead_id || null,
      phone,
      name,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_days: workout_days ? parseInt(workout_days) : null,
      workout_location,
      wake_time,
      sleep_time,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      height: height ? parseFloat(height) : null,
    }).select().single();

    if (error) throw error;

    if (lead_id) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy('Medical flag in intake form', { phone, name, message: medicalText });
    }

    return res.status(200).json({ success: true, id: submission.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Submission failed' });
  }
};
