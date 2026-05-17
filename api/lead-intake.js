const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

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
      diet_preference,
      training_days,
      equipment_access,
      medical_conditions,
      current_weight,
      target_weight,
      daily_schedule,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead_id);

    const intakeData = {
      age, gender, goal, injuries, diet_preference,
      training_days, equipment_access, medical_conditions,
      current_weight, target_weight, daily_schedule, email,
    };

    const medicalText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy(
        'Medical flag in intake form',
        phone || lead.phone,
        medicalText
      );
    }

    await db.from('leads').update({
      program_interest: lead.program_interest,
      status: lead.status === 'new' ? 'qualified' : lead.status,
    }).eq('id', lead_id);

    return res.json({ ok: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
