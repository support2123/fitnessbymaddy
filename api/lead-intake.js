const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_pref, workout_schedule, medical_conditions, current_weight,
      target_weight, experience_level
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const intakeData = {
      name, email, age, gender, goal, injuries,
      diet_pref, workout_schedule, medical_conditions,
      current_weight, target_weight, experience_level
    };

    await db.from('leads')
      .update({
        name: name || lead.name,
        intake_data: intakeData
      })
      .eq('id', lead_id);

    const allText = [goal, injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(allText)) {
      await escalateToMaddy('Intake form flagged', {
        phone: maskPhone(lead.phone),
        detail: `Goal: ${goal}, Injuries: ${injuries}, Medical: ${medical_conditions}`
      });
    }

    return res.status(200).json({ success: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
