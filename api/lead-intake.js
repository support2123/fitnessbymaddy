const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, age, gender, phone, email,
      goal, injuries, diet_preference, schedule,
      experience_level, current_weight, target_weight,
      medical_conditions,
    } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const db = getSupabase();

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy(
        'Intake form: medical condition flagged',
        `Lead: ${maskPhone(phone)} — ${medicalText.substring(0, 200)}`
      );
    }

    const { error } = await db.from('intake_submissions').insert({
      lead_id: lead_id || null,
      name,
      age: age ? parseInt(age) : null,
      gender,
      phone,
      email,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      medical_conditions,
    });

    if (error) throw error;

    if (lead_id) {
      await db.from('leads').update({ name, last_msg_at: new Date().toISOString() }).eq('id', lead_id);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake form' });
  }
};
