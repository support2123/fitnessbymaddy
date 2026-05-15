const { getSupabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, age, gender, height_cm, weight_kg, goal,
      injuries, medical_conditions, diet_preference,
      workout_days_per_week, equipment_access,
      wake_time, sleep_time
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const medicalText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy({
        reason: 'Medical/injury flag in intake form',
        phone: lead.phone,
        details: `Injuries: ${injuries || 'None'}, Medical: ${medical_conditions || 'None'}`
      });
    }

    const { error } = await db.from('intake_submissions').insert({
      lead_id,
      age: age ? parseInt(age) : null,
      gender,
      height_cm: height_cm ? parseFloat(height_cm) : null,
      weight_kg: weight_kg ? parseFloat(weight_kg) : null,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference,
      workout_days_per_week: workout_days_per_week ? parseInt(workout_days_per_week) : null,
      equipment_access,
      wake_time,
      sleep_time
    });

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
