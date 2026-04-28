const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (name) await db.from('leads').update({ name }).eq('id', lead_id);

    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, height
    };

    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `Intake form: ${JSON.stringify(intakeData)}`,
      template_name: 'intake_form'
    });

    return res.json({ success: true, lead_id });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
