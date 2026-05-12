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

  const db = getSupabase();

  try {
    const {
      lead_id,
      name,
      phone,
      email,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      medical_conditions,
      current_weight,
      target_weight,
      experience_level,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const intakeData = {
      name,
      phone,
      email,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      medical_conditions,
      current_weight,
      target_weight,
      experience_level,
    };

    const medicalText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy('Medical/injury flag on intake form', {
        lead_id,
        injuries,
        medical_conditions,
      });
    }

    await db.from('intake_submissions').insert({
      lead_id,
      phone,
      data: intakeData,
      submitted_at: new Date().toISOString(),
    });

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
