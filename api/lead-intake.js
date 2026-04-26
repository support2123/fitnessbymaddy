const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, medical_conditions,
      experience_level, equipment_available
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      program_interest: goal || lead.program_interest
    }).eq('id', lead_id);

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      diet_pref, schedule, medical_conditions,
      experience_level, equipment_available, email
    };

    const { error } = await db.from('leads').update({
      name: name || lead.name,
      first_msg: JSON.stringify(intakeData)
    }).eq('id', lead_id);

    if (error) throw error;

    return res.json({ success: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
