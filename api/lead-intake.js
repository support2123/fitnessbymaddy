const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      schedule, experience_level, photos
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

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = {
      age, gender, height, weight, goal,
      injuries: injuries || 'None',
      medical_conditions: medical_conditions || 'None',
      diet_preference: diet_preference || 'No preference',
      schedule: schedule || 'Flexible',
      experience_level: experience_level || 'Beginner',
      photos: photos || [],
      submitted_at: new Date().toISOString()
    };

    await supabase.from('leads').update({
      name: name || lead.name
    }).eq('id', lead_id);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await supabase.from('clients').update({
        name: name || lead.name,
        email,
        intake_data: intakeData
      }).eq('id', existingClient.id);
    }

    return res.status(200).json({ success: true, message: 'Intake form saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
