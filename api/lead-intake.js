const { getSupabase } = require('./lib/supabase');
const { cors } = require('./lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id,
      name,
      age,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_schedule,
      current_activity,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    await db.from('intake_submissions').insert({
      lead_id,
      age: age ? parseInt(age, 10) : null,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_schedule,
      current_activity,
    });

    return res.json({ ok: true, message: 'Intake form saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
