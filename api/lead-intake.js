const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      experience_level, medical_conditions, current_weight,
      target_weight, height
    } = req.body || {};

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
      age, gender, goal, injuries, diet_preference,
      schedule, experience_level, medical_conditions,
      current_weight, target_weight, height, email
    };

    await supabase
      .from('leads')
      .update({
        ...updates,
        intake_data: intakeData,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('[Intake] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
