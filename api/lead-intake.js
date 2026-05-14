const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_experience,
      available_equipment,
      schedule,
      current_weight,
      target_weight,
    } = req.body;

    if (!lead_id || !name || !email) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, email' });
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

    await db.from('leads').update({ name }).eq('id', lead_id);

    const intakeData = {
      age,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_experience,
      available_equipment,
      schedule,
      current_weight,
      target_weight,
    };

    const escalationText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(escalationText)) {
      await escalateToMaddy(
        'Intake form flagged',
        `Lead: ${maskPhone(phone || lead.phone)} | Issues: ${escalationText}`
      );
    }

    await db.from('leads').update({
      name,
      program_interest: lead.program_interest,
      first_msg: JSON.stringify(intakeData),
    }).eq('id', lead_id);

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
