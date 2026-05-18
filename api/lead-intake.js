const { getSupabase } = require('../lib/supabase');
const { needsEscalation, createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const {
    lead_id, name, age, gender, goal, injuries,
    diet_preference, schedule, medical_conditions, current_activity,
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'missing lead_id' });

  try {
    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'lead not found' });

    await db.from('intake_submissions').insert({
      lead_id,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      medical_conditions,
      current_activity,
    });

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const flagFields = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    const escalationReason = needsEscalation(flagFields);
    if (escalationReason) {
      await createEscalation(lead.phone, `Intake flag: ${escalationReason}`, flagFields);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
};
