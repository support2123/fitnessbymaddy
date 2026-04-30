const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, phone, name, email, age, gender,
      height_cm, weight_kg, goal, injuries,
      medical_conditions, diet_preference,
      training_experience, available_equipment,
      weekly_schedule
    } = req.body;

    if (!lead_id && !phone && !name) {
      return res.status(400).json({ error: 'lead_id, phone, or name required' });
    }

    const db = getSupabase();

    const { data, error } = await db.from('intake_forms').insert({
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
      training_experience,
      available_equipment,
      weekly_schedule
    }).select().single();

    if (error) {
      console.error('Intake insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save form' });
    }

    if (lead_id) {
      await db.from('leads').update({ name, last_msg_at: new Date().toISOString() }).eq('id', lead_id);
    }

    const flagText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(flagText)) {
      await escalateToMaddy(
        'Medical flag in intake form',
        `Name: ${name}\nPhone: ${maskPhone(phone)}\nInjuries: ${injuries || 'None'}\nMedical: ${medical_conditions || 'None'}`
      );
    }

    return res.status(200).json({ success: true, intake_id: data.id });

  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
