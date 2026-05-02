const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, current_weight, height,
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
      program_interest: goal || lead.program_interest,
    }).eq('id', lead_id);

    await db.from('intake_forms').insert({
      lead_id,
      name,
      email,
      phone: phone || lead.phone,
      age: age ? parseInt(age, 10) : null,
      gender,
      goal,
      injuries,
      diet_pref,
      schedule,
      experience,
      medical_conditions,
      current_weight,
      height,
      submitted_at: new Date().toISOString(),
    });

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
