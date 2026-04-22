const { supabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/helpers');
const { sendEscalation } = require('../lib/whatsapp');

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
      height_cm, weight_kg, goal, injuries,
      medical_conditions, diet_preference,
      workout_days, workout_location, wake_time, sleep_time
    } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const escalationFields = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(escalationFields)) {
      await sendEscalation('Intake form — medical flag', phone || 'unknown', escalationFields);
    }

    const { data, error } = await supabase.from('intake_submissions').insert({
      lead_id: lead_id || null,
      phone: phone || null,
      name,
      email,
      age: age ? parseInt(age) : null,
      gender,
      height_cm: height_cm ? parseFloat(height_cm) : null,
      weight_kg: weight_kg ? parseFloat(weight_kg) : null,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference,
      workout_days: workout_days ? parseInt(workout_days) : null,
      workout_location,
      wake_time,
      sleep_time
    }).select().single();

    if (error) throw error;

    if (lead_id) {
      await supabase.from('leads').update({ name, status: 'qualified' }).eq('id', lead_id);
    }

    return res.status(200).json({ status: 'ok', id: data.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Submission failed' });
  }
};
