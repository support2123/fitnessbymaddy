const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const {
    lead_id, name, email, age, goal, injuries,
    diet_preference, schedule, medical_conditions, notes,
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

  try {
    const { data: lead, error } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (error || !lead) return res.status(404).json({ error: 'Lead not found' });

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = { age, goal, injuries, diet_preference, schedule, medical_conditions, notes, email };

    const { error: updateErr } = await db
      .from('leads')
      .update({
        name: name || lead.name,
        first_msg: JSON.stringify(intakeData),
      })
      .eq('id', lead_id);

    if (updateErr) throw updateErr;

    return res.json({ ok: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
