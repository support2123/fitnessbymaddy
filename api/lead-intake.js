const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, age, phone, email, goal,
      injuries, diet_preference, schedule,
      current_weight, height, experience_level
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1)
      .single();

    const intakeData = {
      age, goal, injuries, diet_preference, schedule,
      current_weight, height, experience_level, email
    };

    if (existingClient) {
      await supabase.from('clients')
        .update({ name, email })
        .eq('id', existingClient.id);
    }

    await supabase.from('leads').update({
      name,
      program_interest: goal
    }).eq('id', lead_id);

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
