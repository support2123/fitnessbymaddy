const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://fitnessbymaddy.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_preference,
      workout_days, equipment_access, experience_level,
      wake_time, sleep_time, notes
    } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'Name, email, and phone are required' });
    }

    const db = getSupabase();

    const medicalText = [injuries, medical_conditions, notes].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy(
        `Intake form: medical flag in submission`,
        name,
        phone
      );
    }

    if (lead_id) {
      await db.from('leads').update({
        name,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead_id);
    }

    const { data: existing } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    const leadId = existing?.id || lead_id;

    const intakeData = {
      lead_id: leadId || null,
      name,
      email,
      phone,
      age: age ? parseInt(age, 10) : null,
      gender: gender || null,
      goal: goal || null,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference: diet_preference || null,
      workout_days: workout_days ? parseInt(workout_days, 10) : null,
      equipment_access: equipment_access || null,
      experience_level: experience_level || null,
      wake_time: wake_time || null,
      sleep_time: sleep_time || null,
      notes: notes || null,
      submitted_at: new Date().toISOString()
    };

    await db.from('intake_forms').insert(intakeData);

    return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Intake form error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
