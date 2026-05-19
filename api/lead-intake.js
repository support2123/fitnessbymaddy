const { getSupabase } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const {
    lead_id, name, email, age, goal, injuries,
    diet_preference, schedule, medical_conditions, phone
  } = req.body;

  if (!lead_id && !phone) {
    return res.status(400).json({ error: 'Missing lead_id or phone' });
  }

  try {
    const query = lead_id
      ? db.from('leads').select('*').eq('id', lead_id).single()
      : db.from('leads').select('*').eq('phone', phone).single();

    const { data: lead, error } = await query;
    if (error || !lead) return res.status(404).json({ error: 'Lead not found' });

    const updates = {};
    if (name) updates.name = name;
    if (goal) updates.program_interest = goal;

    const intakeData = { age, goal, injuries, diet_preference, schedule, medical_conditions, email };
    updates.first_msg = JSON.stringify(intakeData);

    await db.from('leads').update(updates).eq('id', lead.id);

    return res.json({ ok: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
