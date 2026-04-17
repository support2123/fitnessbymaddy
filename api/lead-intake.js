const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, age, goal, injuries, diet_preference,
      schedule, medical_conditions, current_weight, target_weight,
      experience_level,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'lead_id is required' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updates = {};
    if (name) updates.name = name;

    const intakeData = {
      email, age, goal, injuries, diet_preference, schedule,
      medical_conditions, current_weight, target_weight,
      experience_level, submitted_at: new Date().toISOString(),
    };

    await supabase
      .from('leads')
      .update({
        ...updates,
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `Intake form submitted: ${JSON.stringify(intakeData)}`,
      status: 'received',
    });

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
