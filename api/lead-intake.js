const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, current_weight, target_weight, height,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy('Medical flag on intake form', {
        phone: phone || 'unknown',
        details: medicalText.slice(0, 300),
      });
    }

    const { error } = await db.from('leads').update({
      name: name || undefined,
    }).eq('id', lead_id);

    if (error) {
      console.error('Lead update error:', error.message);
      return res.status(500).json({ error: 'Failed to update lead' });
    }

    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule,
      experience, medical_conditions, current_weight,
      target_weight, height, email,
    };

    const { error: metaError } = await db.from('leads').update({
      name,
      program_interest: goal || undefined,
    }).eq('id', lead_id);

    return res.json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
