const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      medical_conditions, current_fitness_level
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const intakeData = {
      age, gender, goal, injuries, diet_preference,
      schedule, medical_conditions, current_fitness_level
    };

    await supabase.from('leads').update({
      name: name || undefined,
      intake_data: intakeData,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (client) {
      await supabase.from('clients').update({
        name,
        email
      }).eq('id', client.id);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
