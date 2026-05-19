const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    lead_id,
    name,
    email,
    phone,
    age,
    goal,
    injuries,
    diet_pref,
    schedule,
    current_weight,
    height,
    activity_level,
    medical_conditions
  } = req.body;

  if (!lead_id || !name || !email) {
    return res.status(400).json({ error: 'lead_id, name, and email are required' });
  }

  try {
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase.from('leads').update({
      name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      phone: phone || lead.phone,
      age: age ? parseInt(age) : null,
      goal,
      injuries,
      diet_pref,
      schedule,
      metadata: {
        current_weight,
        height,
        activity_level,
        medical_conditions,
        submitted_at: new Date().toISOString()
      }
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await supabase.from('clients').update({
        name,
        email,
        age: intakeData.age,
        goal,
        injuries,
        diet_pref,
        schedule
      }).eq('id', existingClient.id);
    }

    return res.status(200).json({ success: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
