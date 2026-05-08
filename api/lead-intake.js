const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_preference,
      workout_schedule, equipment_access, experience_level,
      current_weight, target_weight, height
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (email || phone) {
      await supabase.from('leads').update(updates).eq('id', lead_id);
    }

    const intakeData = {
      age, gender, goal, injuries, medical_conditions,
      diet_preference, workout_schedule, equipment_access,
      experience_level, current_weight, target_weight, height,
      email
    };

    const { error: metaErr } = await supabase
      .from('leads')
      .update({
        ...updates,
        first_msg: JSON.stringify(intakeData),
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    if (metaErr) {
      console.error('Intake save error:', metaErr.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ success: true, message: 'Intake form saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
