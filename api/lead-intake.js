const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, age, email, phone, goal, injuries,
      diet_preference, schedule, training_location,
      medical_conditions, experience_level
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads')
      .select('id, phone')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || undefined,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      age, email, goal, injuries, diet_preference,
      schedule, training_location, medical_conditions,
      experience_level, submitted_at: new Date().toISOString()
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1)
      .single();

    if (existingClient) {
      await supabase.from('clients').update({
        name, email
      }).eq('id', existingClient.id);
    }

    return res.status(200).json({ success: true, message: 'Intake form received' });

  } catch (err) {
    console.error('[lead-intake]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
