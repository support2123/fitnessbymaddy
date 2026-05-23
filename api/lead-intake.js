const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      height,
      weight,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_experience,
      available_equipment,
      weekly_schedule,
      wake_time,
      sleep_time
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .maybeSingle();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      phone: phone || lead.phone,
      age,
      gender,
      height,
      weight,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_experience,
      available_equipment,
      weekly_schedule,
      wake_time,
      sleep_time,
      submitted_at: new Date().toISOString()
    };

    const { error } = await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: JSON.stringify(intakeData),
      template_name: 'intake_form'
    });

    if (error) console.error('Insert error:', error.message);

    return res.json({ success: true, message: 'Intake form received' });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
