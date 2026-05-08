const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, medical_conditions, current_weight,
      target_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'lead not found' });

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule,
      experience, medical_conditions, current_weight,
      target_weight, height
    };

    await db.from('leads').update({
      name: name || lead.name,
      program_interest: lead.program_interest || goal
    }).eq('id', lead_id);

    // Store extended intake data as a JSON column update or separate table
    // For now, we store key info on the lead record
    const { data: existing } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existing) {
      await db.from('clients').update({
        name: name || lead.name,
        email
      }).eq('id', existing.id);
    }

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
};
