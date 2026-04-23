const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, current_weight, target_weight, height,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updates = {};
    if (name) updates.name = name;

    const intakeData = {
      email, age, gender, goal, injuries, diet_pref,
      schedule, experience, medical_conditions,
      current_weight, target_weight, height,
    };

    const fieldsToCheck = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(fieldsToCheck)) {
      await escalateToMaddy({
        reason: 'Medical/injury flag in intake form',
        phone: lead.phone,
        context: fieldsToCheck.substring(0, 200),
      });
    }

    if (Object.keys(updates).length > 0) {
      await db.from('leads').update(updates).eq('id', lead_id);
    }

    await db.from('leads').update({
      intake_data: intakeData,
    }).eq('id', lead_id);

    return res.status(200).json({ ok: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
