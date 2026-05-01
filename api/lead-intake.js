const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

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
      diet_pref,
      schedule,
      current_weight,
      target_weight,
      experience_level,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id is required' });
    }

    const { data: lead, error: leadErr } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (lead.status === 'new') updates.status = 'qualified';

    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule,
      current_weight, target_weight, experience_level, email,
    };
    updates.first_msg = JSON.stringify(intakeData);

    await db.from('leads').update(updates).eq('id', lead_id);

    return res.status(200).json({ ok: true, lead_id });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
