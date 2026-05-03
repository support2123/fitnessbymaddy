const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_preference, training_days,
    wake_time, sleep_time, supplements, medical_conditions
  } = req.body;

  if (!lead_id) {
    return res.status(400).json({ error: 'Missing lead_id' });
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
      name: name || lead.name
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      age: parseInt(age) || null,
      gender,
      height,
      weight: parseFloat(weight) || null,
      goal,
      injuries: injuries || null,
      diet_preference,
      training_days: parseInt(training_days) || null,
      wake_time,
      sleep_time,
      supplements: supplements || null,
      medical_conditions: medical_conditions || null
    };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await supabase.from('clients').update({
        name,
        email
      }).eq('id', existingClient.id);
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Submission failed' });
  }
};
