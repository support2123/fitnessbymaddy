const { getClient } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, training_days,
      experience_level, current_weight, target_weight,
      medical_conditions, supplements, schedule_preference
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getClient();

    const { data: lead } = await db.from('leads').select('*').eq('id', lead_id).single();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    // Store intake data as a client profile note (will be used when converting)
    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: JSON.stringify({
        type: 'intake_form',
        name, email, age, gender, goal, injuries,
        diet_preference, training_days, experience_level,
        current_weight, target_weight, medical_conditions,
        supplements, schedule_preference
      }),
      template_name: 'intake_form',
      status: 'received'
    });

    return res.json({ success: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
