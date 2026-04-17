const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, schedule,
      medical_conditions, experience_level,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase.from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    // Store intake data as a JSON note on the lead for now
    // This gets transferred to the client record on conversion
    const intakeData = {
      email, age, gender, height, weight, goal,
      injuries, diet_preference, schedule,
      medical_conditions, experience_level,
      submitted_at: new Date().toISOString(),
    };

    await supabase.from('leads')
      .update({
        name: name || lead.name,
        first_msg: JSON.stringify(intakeData),
      })
      .eq('id', lead_id);

    return res.status(200).json({ success: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
