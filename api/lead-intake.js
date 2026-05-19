const { getSupabase } = require('./lib/supabase');
const { corsHeaders } = require('./lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id,
      name,
      email,
      age,
      gender,
      height,
      current_weight,
      goal_weight,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      schedule,
      experience_level,
      equipment_access
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db.from('leads').select('*').eq('id', lead_id).single();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({ name: name || lead.name }).eq('id', lead_id);

    const intakeData = {
      age, gender, height, current_weight, goal_weight, goal,
      injuries, medical_conditions, diet_preference, schedule,
      experience_level, equipment_access, email
    };

    const { error } = await db.from('leads').update({
      name: name || lead.name,
      intake_data: intakeData
    }).eq('id', lead_id);

    if (error) {
      console.error('[lead-intake] DB error:', error.message);
      return res.status(500).json({ error: 'Failed to save' });
    }

    if (medical_conditions && medical_conditions.trim().length > 0) {
      const { escalateToMaddy } = require('./lib/escalation');
      await escalateToMaddy('Medical condition reported in intake form', lead, medical_conditions);
    }

    return res.status(200).json({ ok: true, message: 'Intake saved successfully' });
  } catch (err) {
    console.error('[lead-intake] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
